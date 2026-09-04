import LiveQrOrder from "@/components/LiveQrOrder";

type QrMenuPageProps = { params: Promise<{ token: string }> };

export default async function QrMenuPage({ params }: QrMenuPageProps) {
  const { token } = await params;
  return <LiveQrOrder qrToken={token} />;
}
