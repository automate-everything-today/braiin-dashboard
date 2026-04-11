"use client";

import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle size={40} className="text-yellow-500 mb-4" />
          <h2 className="text-lg font-bold text-zinc-700 mb-2">Something went wrong</h2>
          <p className="text-sm text-zinc-400 mb-4">This page encountered an error.</p>
          {this.state.error && (
            <pre className="text-[10px] text-red-500 bg-red-50 p-3 rounded max-w-md mb-4 text-left overflow-auto max-h-32">
              {this.state.error.message}
              {"\n"}
              {this.state.error.stack?.split("\n").slice(0, 5).join("\n")}
            </pre>
          )}
          <button
            onClick={() => this.setState({ hasError: false })}
            className="flex items-center gap-2 px-4 py-2 bg-[#1B2A4A] text-white rounded text-sm hover:bg-[#2a3d63]"
          >
            <RefreshCw size={14} />
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
