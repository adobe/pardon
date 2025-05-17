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
