import styles from "../Dashboard.module.css";

export function ConnectionError({ detail }: { detail: string }) {
  return (
    <p className={styles.connectionError} role="alert">
      {detail}
    </p>
  );
}
