import type { Metadata } from "next";
import styles from "./placeholder.module.css";

export const metadata: Metadata = {
  title: "Portal Pelanggan",
};

export default function CustomerPortalPage() {
  return (
    <main className={styles.container}>
      <h1 className={styles.heading}>Portal Pelanggan</h1>
      <p className={styles.description}>
        Halaman reservasi pelanggan sedang disiapkan.
      </p>
    </main>
  );
}
