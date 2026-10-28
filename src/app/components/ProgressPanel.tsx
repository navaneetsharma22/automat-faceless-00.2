import styles from "../Dashboard.module.css";

export type DemoProgress = { label: string; detail: string; value: number };

export function ProgressPanel({ items }: { items: DemoProgress[] }) {
  return (
    <section
      className={`${styles.panel} ${styles.progressPanel}`}
      aria-labelledby="progress-title"
    >
      <div className={styles.panelHeading}>
        <div>
          <p className={styles.kicker}>DEMO PROGRESS</p>
          <h2 id="progress-title">Batch overview</h2>
        </div>
      </div>
      <div className={styles.progressList}>
        {items.map((item) => (
          <article className={styles.progressCard} key={item.label}>
            <div className={styles.progressMeta}>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </div>
            <div
              className={styles.progressTrack}
              role="img"
              aria-label={`${item.value}% example progress`}
            >
              <span style={{ width: `${item.value}%` }} />
            </div>
            <span className={styles.progressValue}>{item.value}% example</span>
          </article>
        ))}
      </div>
    </section>
  );
}
