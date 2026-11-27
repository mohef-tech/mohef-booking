import type { Metadata } from "next";
import styles from "../placeholder.module.css";

export const metadata: Metadata = {
  title: "Workspace Kasir",
};

export default function CashierWorkspacePage() {
  return (
    <main className={styles.container}>
      <h1 className={styles.heading}>Workspace Kasir</h1>
      <p className={styles.description}>
        Kalender operasional kasir sedang disiapkan.
      </p>
    </main>
  );
}
