import { ChangeRequestWidget } from "@/components/change-request-widget";

export default function DevLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <ChangeRequestWidget />
    </>
  );
}
