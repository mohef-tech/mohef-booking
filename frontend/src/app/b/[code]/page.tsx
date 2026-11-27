import type { Metadata } from "next";
import styles from "../../placeholder.module.css";

type BookingStatusPageProps = {
  params: Promise<{ code: string }>;
};

export async function generateMetadata({
  params,
}: BookingStatusPageProps): Promise<Metadata> {
  const { code } = await params;
  return {
    title: `Status Booking ${code}`,
  };
}

export default async function BookingStatusPage({
  params,
}: BookingStatusPageProps) {
  const { code } = await params;

  return (
    <main className={styles.container}>
      <h1 className={styles.heading}>Status Booking</h1>
      <p className={styles.description}>
        Halaman status publik untuk kode booking{" "}
        <span className={styles.code}>{code}</span> sedang disiapkan.
      </p>
    </main>
  );
}
