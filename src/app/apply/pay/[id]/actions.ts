"use server";

import { notFound, redirect } from "next/navigation";

import { clearDues, createHandoff, PaymentNotAvailableError } from "@/lib/membership/payment";
import { membershipRepository } from "@/lib/membership/repository";

/**
 * Begin the hosted-checkout handoff.
 *
 * Stubbed: no Stripe session is created. In production this calls Stripe with
 * the Association's own account key and redirects to `session.url`, and the
 * page the applicant lands on is entirely the provider's. Under PCI SAQ A that
 * is the requirement, not a preference: one merchant-side script on the payment
 * page moves the organization to SAQ A-EP.
 */
export async function beginCheckout(form: FormData): Promise<void> {
  const applicationId = String(form.get("applicationId") ?? "");
  try {
    await createHandoff(membershipRepository(), applicationId);
  } catch (error) {
    if (error instanceof PaymentNotAvailableError) notFound();
    throw error;
  }
  redirect(`/apply/pay/${encodeURIComponent(applicationId)}/handoff`);
}

/**
 * Dev-only. Stands in for the Stripe webhook.
 *
 * Only a verified webhook may clear a payment. The success URL the applicant
 * returns to is a claim about a payment, not a payment, and a system that
 * treats the two as the same grants membership to anyone who can edit a URL.
 */
export async function simulateWebhook(form: FormData): Promise<void> {
  const handoffId = String(form.get("handoffId") ?? "");
  const applicationId = String(form.get("applicationId") ?? "");
  try {
    await clearDues(membershipRepository(), handoffId);
  } catch (error) {
    if (error instanceof PaymentNotAvailableError) notFound();
    throw error;
  }
  redirect(`/apply/pay/${encodeURIComponent(applicationId)}/handoff?cleared=1`);
}
