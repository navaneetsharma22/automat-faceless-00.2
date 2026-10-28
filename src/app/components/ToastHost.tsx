import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import styles from "./Toast.module.css";
import { Toast } from "./Toast";
import { ToastManager } from "./toastManager";

const ToastContext = createContext<ToastManager | null>(null);

export type ToastHostProps = {
  children: ReactNode;
  maxVisible?: number;
};

export function ToastHost({ children, maxVisible = 4 }: ToastHostProps) {
  const [manager] = useState(() => new ToastManager(maxVisible));
  const [notifications, setNotifications] = useState(manager.getSnapshot());

  useEffect(() => {
    const unsubscribe = manager.subscribe(setNotifications);
    return () => {
      unsubscribe();
      manager.dispose();
    };
  }, [manager]);

  return (
    <ToastContext.Provider value={manager}>
      {children}
      <div className={styles.host} aria-label="Notifications">
        {notifications.map((notification) => (
          <Toast
            key={notification.id}
            notification={notification}
            manager={manager}
            onDismiss={() => manager.dismiss(notification.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastManager {
  const manager = useContext(ToastContext);
  if (!manager) {
    throw new Error("useToast must be used inside a ToastHost.");
  }
  return manager;
}
