import styles from "../Dashboard.module.css";

export type Workspace = "Images" | "References" | "Videos" | "Downloads";

const workspaces: Workspace[] = ["Images", "References", "Videos", "Downloads"];

export function Navigation({
  active,
  onSelect,
}: {
  active: Workspace;
  onSelect: (workspace: Workspace) => void;
}) {
  return (
    <nav className={styles.navigation} aria-label="Workspace">
      {workspaces.map((workspace, index) => (
        <button
          aria-current={active === workspace ? "page" : undefined}
          className={`${styles.navItem} ${active === workspace ? styles.navItemActive : ""} motion-control`}
          key={workspace}
          onClick={() => onSelect(workspace)}
          type="button"
        >
          <span className={styles.navIndex}>0{index + 1}</span>
          <span>{workspace}</span>
        </button>
      ))}
    </nav>
  );
}
