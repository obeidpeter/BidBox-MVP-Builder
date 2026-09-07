import { Route, Switch } from "wouter";
import SignInPage, {
  AccessCallbackPage,
  InvitationPage,
} from "@/pages/sign-in";

export default function AccessRoutes() {
  return (
    <Switch>
      <Route path="/sign-in" component={SignInPage} />
      <Route path="/accept-invitation" component={InvitationPage} />
      <Route path="/sso-callback" component={AccessCallbackPage} />
      <Route component={SignInPage} />
    </Switch>
  );
}
