import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const BID_AUTOPSY_REQUEST_PATH = "/request-bid-autopsy";

export function BidAutopsyCta({
  className,
  size = "lg",
  ...props
}: Omit<ButtonProps, "asChild" | "children">) {
  return (
    <Button
      asChild
      size={size}
      className={cn("min-h-11", className)}
      {...props}
    >
      <Link href={BID_AUTOPSY_REQUEST_PATH}>
        Request a Bid Autopsy
        <ArrowRight aria-hidden="true" />
      </Link>
    </Button>
  );
}
