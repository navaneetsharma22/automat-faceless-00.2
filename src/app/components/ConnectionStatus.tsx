import styles from "../Dashboard.module.css";

export function ConnectionStatus() {
  return (
    <section className={styles.connection} aria-labelledby="connection-title">
      <div className={styles.connectionHeading}>
        <span className={styles.statusDot} aria-hidden="true" />
        <h2 id="connection-title">Connections</h2>
      </div>
      <p>Provider actions are unavailable in this UI demonstration.</p>
      <ul>
        <li>
          <span>Flow</span>
          <strong>Not connected</strong>
        </li>
        <li>
          <span>Vids</span>
          <strong>Not connected</strong>
        </li>
      </ul>
    </section>
  );
}
