import { redirect } from "next/navigation";
import { AccountShell } from "@/app/components/account-shell";
import { getViewer } from "@/server/auth";
import { getBookingCalendarContext } from "@/server/booking-service";
import { BookingCalendar } from "./booking-calendar";

export default async function BookingCalendarPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.tenant) redirect("/account");

  const context = await getBookingCalendarContext(viewer.tenant);
  return (
    <AccountShell
      title="Booking calendar"
      description={`View the schedule for ${viewer.tenant.businessName} in ${context.timeZone}.`}
      viewer={viewer}
      wide
    >
      <BookingCalendar
        initialLocalDate={context.localDate}
        timeZone={context.timeZone}
      />
    </AccountShell>
  );
}
