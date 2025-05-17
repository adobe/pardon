/** @type {import("tailwindcss").Config} */
export default {
  content: ["./src/**/*.{html,jsx,tsx,css}"],
  theme: {
    fontFamily: {
      mono: ["Source Code Pro", "Consolas", "monospace"],
      sans: [
        "Source Code Pro",
        "-apple-system",
        "BlinkMacSystemFont",
        "Segoe UI",
        "sans-serif",
        "Apple Color Emoji",
        "Segoe UI Emoji",
        "Segoe UI Symbol",
      ],
      weird: ["Courier New", "Courier"],
    },
    extend: {
      borderWidth: {
        1: "1px",
      },
      boxShadow: {
        drop: "0 8px 6px -8px",
      },
      colors: {
        corvu: {
          bg: "#f3f1fe",
          100: "#e6e2fd",
          200: "#d4cbfb",
          300: "#bcacf6",
          400: "#a888f1",
          text: "#180f24",
        },
        carbon: {
          50: "#f3f3f3",
          100: "#dcdcdc",
          200: "#bebebe",
          300: "#a4a4a4",
          400: "#8c8c8c",
          500: "#6f6f6f",
          600: "#565656",
          700: "#3d3d3d",
          800: "#282828",
          900: "#171717",
        },
      },
    },
  },
};
