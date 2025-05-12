import { Match, Switch, type VoidProps } from "solid-js";
import {
  TbMoodSad,
  TbMoodSmile,
  TbMoodAnnoyed,
  TbMoodEdit,
  TbMoodNeutral,
  TbMoodUnamused,
} from "solid-icons/tb";
import "./playground-mood.css";

export type Mood = "confused" | "confuzzled" | "happy" | "thinking" | "error";

export default function PardonPlaygroundMood(
  props: VoidProps<{
    mood: Mood;
    type?: "request" | "response";
    iconSize?: number | string;
  }>,
) {
  const ThinkingMoodIcon =
    props.type === "response" ? TbMoodNeutral : TbMoodEdit;

  return (
    <Switch>
      <Match when={props.mood === "confused"}>
        <TbMoodAnnoyed size={props.iconSize} />
      </Match>
      <Match when={props.mood === "confuzzled"}>
        <TbMoodUnamused size={props.iconSize} />
      </Match>
      <Match when={props.mood === "error"}>
        <TbMoodSad size={props.iconSize} />
      </Match>
      <Match when={props.mood === "thinking"}>
        <ThinkingMoodIcon class="pulse" color="gray" size={props.iconSize} />
      </Match>
      <Match when={props.mood === "happy"}>
        <TbMoodSmile color="gray" size={props.iconSize} />
      </Match>
    </Switch>
  );
}
