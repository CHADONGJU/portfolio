export const createRefreshCoordinator = () => {
  let activeRunId = 0;
  let inFlight = false;

  return {
    begin() {
      if (inFlight) return null;
      activeRunId += 1;
      inFlight = true;
      return activeRunId;
    },
    finish(runId) {
      if (runId !== activeRunId) return false;
      inFlight = false;
      return true;
    },
    isCurrent(runId) {
      return inFlight && runId === activeRunId;
    },
    isInFlight() {
      return inFlight;
    },
  };
};
