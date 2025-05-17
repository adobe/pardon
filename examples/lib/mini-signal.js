export function createSignal(value) {
  return [
    () => value,
    (setter) => {
      if (typeof setter === "function") {
        value = setter(value);
      } else {
        value = setter;
      }
    },
  ];
}
