import { createTirveaClient } from "./index";

/**
 * The web app's shared same-origin client instance (cookie transport).
 * Client components import this instead of constructing their own;
 * native/Capacitor shells construct theirs with baseUrl + getAccessToken.
 */
export const api = createTirveaClient();
