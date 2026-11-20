import { notFound, redirect } from "next/navigation";
import { AccountShell } from "@/app/components/account-shell";
import { getViewer } from "@/server/auth";
import { StorageError } from "@/server/auth-storage";
import { getBooking } from "@/server/booking-service";
import { parseBookingId } from "@/server/booking-validation";
import { getBookingPayments } from "@/server/payment-service";
import { BookingDetailPanel } from "./booking-detail-panel";

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.tenant) redirect("/account");
  let bookingId: string;
  try {
    bookingId = parseBookingId((await params).bookingId);
  } catch {
    notFound();
  }
  let booking;
  let payments;
  try {
    booking = await getBooking(viewer.tenant, bookingId);
    payments = await getBookingPayments(viewer.tenant, bookingId);
  } catch (error) {
    if (error instanceof StorageError && error.status === 404) notFound();
    throw error;
  }
  return (
    <AccountShell
      title="Booking details"
      description={`View and manage this Booking for ${viewer.tenant.businessName}.`}
      viewer={viewer}
      wide
    >
      <BookingDetailPanel
        canManageServices={viewer.tenant.role === "company_admin"}
        initialBooking={booking}
        initialPayments={payments}
      />
    </AccountShell>
  );
}
