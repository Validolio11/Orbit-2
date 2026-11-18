// Tauri 2's global API is enabled by app.withGlobalTauri.
function tauri() {
  if (!window.__TAURI__) {
    throw new Error("Немає з’єднання з Orbit. Відкрийте сторінку у застосунку.");
  }
  return window.__TAURI__;
}

export function invoke(command, args = {}) {
  return tauri().core.invoke(command, args);
}

export function listen(event, callback) {
  return tauri().event.listen(event, ({ payload }) => callback(payload));
}

export const getState = () => invoke("get_state");
export const openWheelPreview = () => invoke("open_wheel_preview");
export const closeWheel = () => invoke("close_wheel");
export const windowCommand = (action) => invoke("window_command", { action });
