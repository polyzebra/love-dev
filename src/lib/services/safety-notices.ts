import { notifyUser, type NotifyResult } from "@/lib/services/notify";

/**
 * Trust & safety notification templates - the single place the calm,
 * legally-safe user-facing copy for enforcement/appeal notices lives.
 *
 * Delivery is the EXISTING notifyUser outbox: SAFETY-typed notifications
 * bypass quiet hours, write an in-app Notification row always, and create
 * EMAIL/SMS delivery rows per the user's safety preferences. Transport
 * honesty is inherited: without RESEND_API_KEY the email rows go DEAD with
 * errorCode "not_configured" - nothing is ever fake-sent.
 *
 * Copy rules (per spec): short, professional, never accusatory, never
 * exposing internal reasons/confidence/thresholds. The userVisibleReason
 * for the specific violation is rendered by the phase-2 UI from
 * getAccountStatusView - these notices deliberately stay generic.
 */

export type SafetyNoticeKind =
  | "warning"
  | "photo_removed"
  | "verification_required"
  | "limited"
  | "suspended"
  | "banned"
  | "appeal_submitted"
  | "appeal_approved"
  | "appeal_rejected";

export const SAFETY_NOTICE_COPY: Record<SafetyNoticeKind, { title: string; body: string }> = {
  warning: {
    title: "A note about your account",
    body:
      "Something on your profile didn't follow our Community Guidelines. " +
      "No action is needed right now - please review our guidelines to keep your account in good standing.",
  },
  photo_removed: {
    title: "A photo was removed",
    body:
      "One of your photos didn't follow our Community Guidelines and has been removed. " +
      "You can review the details and add a different photo any time.",
  },
  verification_required: {
    title: "Please verify your profile",
    body:
      "To keep Tirvea safe, we need you to complete photo verification before continuing. " +
      "It only takes a minute and your photos stay private.",
  },
  limited: {
    title: "Your account is temporarily limited",
    body:
      "Some features are paused on your account for a short period following a review. " +
      "You can see the details and what happens next in your account status page.",
  },
  suspended: {
    title: "Your account has been suspended",
    body:
      "Your account was suspended following a review. A member of our team will look at it - " +
      "you can read the details and submit an appeal from your account status page.",
  },
  banned: {
    title: "Your account has been closed",
    body:
      "Your account was closed following a review of activity that goes against our Community Guidelines. " +
      "If you believe this is a mistake, you can submit an appeal and a person will review it.",
  },
  appeal_submitted: {
    title: "We received your appeal",
    body:
      "Thanks - your appeal has been submitted. A member of our team will review it personally. " +
      "This can take a little time, and we will let you know the outcome.",
  },
  appeal_approved: {
    title: "Your appeal was approved",
    body:
      "Good news - after review, we've reversed the action on your account. " +
      "Everything affected has been restored. Thanks for your patience.",
  },
  appeal_rejected: {
    title: "An update on your appeal",
    body:
      "After a careful review by our team, the action on your account stays in place. " +
      "You can read the details in your account status page.",
  },
};

/**
 * Queue one safety notice through the notification outbox. `dedupeKey`
 * should be derived from the triggering row (e.g. `violation:{id}:notice`)
 * so retries/replays never double-notify.
 */
export async function sendSafetyNotice(
  userId: string,
  kind: SafetyNoticeKind,
  dedupeKey: string,
  data?: Record<string, string | number | boolean | null>,
): Promise<NotifyResult> {
  const copy = SAFETY_NOTICE_COPY[kind];
  return notifyUser({
    userId,
    type: "SAFETY",
    title: copy.title,
    body: copy.body,
    url: "/account-blocked",
    dedupeKey,
    data: { noticeKind: kind, ...(data ?? {}) },
  });
}
