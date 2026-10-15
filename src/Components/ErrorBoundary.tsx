import React from "react";

// Catches a crash inside part of the screen, so one broken piece (a page
// whose code failed to download after a new release, a bad record) shows a
// way out instead of a blank white page. Used around every page and around
// the exam calculator, where a failure must never take the paper with it.

type Props = { children: React.ReactNode; fallback?: (retry: () => void) => React.ReactNode; resetKey?: unknown };
type State = { failed: boolean };

class ErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    // Kept in the console for support; nothing sensitive is in a render error.
    console.error("Screen error:", error);
  }

  componentDidUpdate(prev: Props) {
    // Moving to another page clears a previous page's failure.
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  retry = () => this.setState({ failed: false });

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.retry);
    return (
      <div role="alert" style={{ margin: "15vh auto", maxWidth: 440, padding: "0 20px", textAlign: "center", fontFamily: "inherit" }}>
        <h2 style={{ margin: "0 0 8px" }}>{"Something went wrong on this screen"}</h2>
        <p style={{ margin: "0 0 18px", color: "var(--ink-2)" }}>
          {"Usually a new version of Schoolivio has just been released. Reloading fixes it."}
        </p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          {"Reload"}
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
