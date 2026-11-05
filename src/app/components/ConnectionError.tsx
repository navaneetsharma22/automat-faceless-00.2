import styles from "../Dashboard.module.css";

export function connectionErrorParts(detail: string) {
  const match = /^([a-zA-Z0-9_/-]{1,120}):\s*/.exec(detail);
  const rawMessage = match ? detail.slice(match[0].length) : detail;
  const message = rawMessage
    .slice(0, 320)
    .replace(/\b(?:https?|blob|chrome-extension):\/\/[^\s)]+/gi, "[URL omitted]")
    .replace(/([?&][^=&#\s]+=)[^&#\s]+/g, "$1[redacted]");
  return { code: match?.[1], message };
}

export function ConnectionError({ detail }: { detail: string }) {
  const { message } = connectionErrorParts(detail);
  return (
    <p className={styles.connectionError} role="alert">
      {message}
    </p>
  );
}
