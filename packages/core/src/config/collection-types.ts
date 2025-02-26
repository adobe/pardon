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
import { type HttpsSteps } from "../core/formats/https-fmt.js";
import { EncodingTypes } from "../core/request/body-template.js";
import {
  DefaultsMap,
  type ConfigMap,
} from "../core/schema/core/config-space.js";

export type Helper = {
  config: string;
  path: string;
  exports: string[];
};

export type ConfigurationImports = Record<string, string | string[]>;

export type AssetParseError = { path: string; error: any };

export type ResourceProcessingPhase = "source" | "runtime";

export type Configuration<
  ProcessingPhase extends ResourceProcessingPhase = "runtime",
> = {
  name: string;
  path: string;
  defaults?: DefaultsMap;
  mixin?: string | string[];
  import?: ConfigurationImports;
  export?: string;
  encoding?: EncodingTypes;
  search?: "multi";
  type?: "service" | "config";
} & (ProcessingPhase extends "source"
  ? {
      config?: ConfigMap | Record<string, string>[];
    }
  : {
      config: Record<string, string>[];
    });

export type EndpointConfiguration = Omit<Configuration, "export"> & {
  mode?: "mix" | "mux";
};

// TODO
//  refactor endpoints/mixins to
//  a sequence of layers of { dirname, steps, configuration }.
//   - all endpoint layers must apply to a request to match (bottom up).
//   - then mixins from the endpoints' configurations are applied (top down).
export type Endpoint = {
  service: string;
  action: string;
  asset: string;
  steps: HttpsSteps;
  configuration: EndpointConfiguration;
};

export type EndpointStepsLayer = {
  path: string;
  steps: HttpsSteps;
  mode?: "mix" | "mux";
};

export type LayeredEndpoint = {
  service: string;
  action: string;
  configuration: EndpointConfiguration;
  layers: EndpointStepsLayer[];
};

export type LayeredMixin = {
  configuration: EndpointConfiguration;
  layers: EndpointStepsLayer[];
};
