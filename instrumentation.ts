export async function register() {
  // The scheduler needs Node APIs and the database, so it only runs in the Node runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startScheduler } = await import("./lib/scheduler");
  startScheduler();
}
