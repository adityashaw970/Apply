// Runs outside Electron's main process. A failed request, parser, or worker
// process can therefore not take down the application window.
const { ATSPoller } = require("./ats-poller");

const poller = new ATSPoller();
let busy = false;

process.on("message", async (message) => {
  if (!message || message.type !== "poll" || busy) return;
  busy = true;
  try {
    for (const company of message.companies || []) {
      if (!company.active) continue;
      let jobs = [];
      try {
        jobs = await poller.fetchJobsForCompany(company);
      } catch (error) {
        process.send?.({ type: "company-error", companyId: company.id, error: error.message });
      }
      process.send?.({ type: "company", company, jobs });
    }
    process.send?.({ type: "complete" });
  } catch (error) {
    process.send?.({ type: "error", error: error.message });
  } finally {
    busy = false;
  }
});
