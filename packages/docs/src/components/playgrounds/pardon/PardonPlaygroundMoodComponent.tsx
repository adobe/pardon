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
import { Match, Switch, type VoidProps } from "solid-js";
import "./playground-mood.css";

export type Mood = "confused" | "confuzzled" | "happy" | "thinking" | "error";

export default function PardonPlaygroundMoodComponent(
  props: VoidProps<{
    mood: Mood;
    type?: "request" | "response";
  }>,
) {
  const ThinkingMoodIcon =
    props.type === "response" ? IconTablerMoodNeutral : IconTablerMoodEdit;

  return (
    <Switch>
      <Match when={props.mood === "confused"}>
        <IconTablerMoodAnnoyed class="text-2xl" color="gray" />
      </Match>
      <Match when={props.mood === "confuzzled"}>
        <IconTablerMoodUnamused class="text-2xl" color="gray" />
      </Match>
      <Match when={props.mood === "error"}>
        <IconTablerMoodSad class="text-2xl" color="gray" />
      </Match>
      <Match when={props.mood === "thinking"}>
        <ThinkingMoodIcon class="pulse text-2xl" color="gray" />
      </Match>
      <Match when={props.mood === "happy"}>
        <IconTablerMoodSmile color="gray" class="text-2xl" />
      </Match>
    </Switch>
  );
}
