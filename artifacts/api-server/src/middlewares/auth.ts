import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isBootstrapIdentity } from "../lib/bootstrap";
import type { LocalUser } from "../lib/accessContext";
export type { LocalUser } from "../lib/accessContext";

function getLocalUser(req: Request): LocalUser | undefined {
  return (req as unknown as { localUser?: LocalUser }).localUser;
}

export { getLocalUser };

/**
 * Requires a valid Clerk session, then loads (or just-in-time provisions) the
 * matching internal user row. Elevated bootstrap access is granted only to an
 * identity explicitly named in VALO_BOOTSTRAP_CLERK_USER_IDS or
 * VALO_BOOTSTRAP_EMAILS. Database insertion order never grants privilege.
 */
export async function attachUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = getAuth(req);
    const clerkUserId = auth?.userId;

    if (!clerkUserId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.clerkUserId, clerkUserId));

    if (!user) {
      let email = `${clerkUserId}@unknown.local`;
      let name: string | null = null;
      try {
        const cu = await clerkClient.users.getUser(clerkUserId);
        email =
          cu.primaryEmailAddress?.emailAddress ||
          cu.emailAddresses[0]?.emailAddress ||
          email;
        name =
          [cu.firstName, cu.lastName].filter(Boolean).join(" ") ||
          cu.username ||
          null;
      } catch {
        // Fall back to placeholder identity if Clerk lookup fails.
      }

      const bootstrap = isBootstrapIdentity(
        { clerkUserId, email },
        {
          clerkUserIds: process.env.VALO_BOOTSTRAP_CLERK_USER_IDS,
          emails: process.env.VALO_BOOTSTRAP_EMAILS,
        },
      );

      [user] = await db
        .insert(users)
        .values({
          clerkUserId,
          email,
          name,
          role: bootstrap ? "restricted_platform_administrator" : "none",
          status: "active",
          lastLoginAt: new Date(),
        })
        .onConflictDoUpdate({
          target: users.clerkUserId,
          set: { lastLoginAt: new Date() },
        })
        .returning();
    } else {
      const bootstrap = isBootstrapIdentity(
        { clerkUserId, email: user.email },
        {
          clerkUserIds: process.env.VALO_BOOTSTRAP_CLERK_USER_IDS,
          emails: process.env.VALO_BOOTSTRAP_EMAILS,
        },
      );
      const role =
        user.role === "none" && bootstrap
          ? "restricted_platform_administrator"
          : user.role;
      await db
        .update(users)
        .set({ lastLoginAt: new Date(), role })
        .where(eq(users.id, user.id));
      user = { ...user, role };
    }

    if (user.status === "disabled") {
      res.status(403).json({ error: "Account disabled" });
      return;
    }

    (req as unknown as { localUser?: LocalUser }).localUser = user;
    next();
  } catch (error) {
    req.log.error({ err: error }, "attachUser failed");
    res.status(500).json({ error: "Authentication error" });
  }
}
