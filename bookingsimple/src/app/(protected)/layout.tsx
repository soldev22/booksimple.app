import { redirect } from "next/navigation";
import { getViewer } from "@/server/auth";
import { RootDocument } from "../components/root-document";

export { metadata } from "../components/root-document";

export default async function ProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (!(await getViewer())) redirect("/login");
  return <RootDocument>{children}</RootDocument>;
}
