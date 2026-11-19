import { Component, type ReactNode } from "react";

/** 화면·지도 단위 에러 바운더리: 한 부분이 깨져도 나머지는 동작하게 한다 */
export class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("[ErrorBoundary]", error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
