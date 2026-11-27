import type { Metadata } from "next";
import styles from "../placeholder.module.css";

export const metadata: Metadata = {
  title: "Workspace Admin",
};

export default function AdminWorkspacePage() {
  return (
    <main className={styles.container}>
      <h1 className={styles.heading}>Workspace Admin</h1>
      <p className={styles.description}>
        Panel pengelolaan unit, tarif, dan jadwal admin sedang disiapkan.
      </p>
    </main>
  );
}
