/*
Copyright 2025 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/

import { RequestJSON, ResponseJSON } from "pardon/formats";
import type { PardonElectronApi } from "./preload.js";
import { PardonHttpExecutionContext } from "pardon/features/remember";

// Used in Renderer process, expose in `preload.ts`
declare global {
  const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
  const MAIN_WINDOW_VITE_NAME: string;

  interface Window {
    pardon: PardonElectronApi;
  }

  type PardonManifest = Awaited<ReturnType<PardonElectronApi["manifest"]>>;
  type PardonPreview = Awaited<ReturnType<PardonElectronApi["preview"]>>;
  type PardonRender = Awaited<ReturnType<PardonElectronApi["render"]>>;
  type PardonResult = Awaited<ReturnType<PardonElectronApi["continue"]>>;

  type Preferences = {
    cwd?: string;
  };

  type PardonExecutionSource = {
    http: string;
    values: Record<string, unknown>; // actual values, usually the combined value
  };

  type PardonExecutionRender = {
    context: {
      trace: number;
      ask: string;
      durations: PardonHttpExecutionContext["durations"];
    };
    outbound: {
      request: RequestJSON;
      values?: Record<string, unknown>;
    };
    secure: {
      outbound: {
        request: RequestJSON;
        values?: Record<string, unknown>;
      };
    };
    error?: any;
  };

  type ExecutionHistory = {
    context: {
      trace: number;
      ask: string;
    };
    outbound: {
      request: RequestJSON;
      values?: Record<string, unknown>;
    };
    inbound: {
      outcome?: string;
      response: ResponseJSON;
      values: Record<string, unknown>;
    };
    error?: any;
  };

  type Optional<T, Keys extends keyof T> = Omit<T, Keys> &
    Partial<Pick<T, Keys>>;

  type TracingHookPayloads = {
    onRenderStart: {
      trace: number;
      context: { ask: string; endpoint: string };
      awaited: { requests: number[] };
    };
    onRenderComplete: {
      trace: number;
      context: unknown;
      awaited: {
        requests: number[];
        results: number[];
      };
      outbound: {
        request: RequestJSON;
        values: Record<string, unknown>;
      };
      secure?: {
        outbound: {
          request: RequestJSON;
          values: Record<string, unknown>;
        };
      };
    };
    onSend: {
      trace: number;
    };
    onError: {
      trace: number;
      step: string;
      error: any;
    };
    onResult: {
      trace: number;
      context: unknown;
      awaited: { requests: number[]; results: number[] };
      inbound: {
        outcome?: string;
        response: ResponseJSON;
        values: Record<string, unknown>;
        flow: Record<string, unknown>;
      };
      secure?: {
        inbound: {
          response: ResponseJSON;
          values: Record<string, unknown>;
        };
      };
    };
  };
}

declare module "solid-js" {
  namespace JSX {
    interface CustomEvents {
      [on: string]: Event;
    }
    interface CustomCaptureEvents {
      copy: ClipboardEvent;
      paste: ClipboardEvent;
      [oncapture: string]: Event;
    }
  }
}
