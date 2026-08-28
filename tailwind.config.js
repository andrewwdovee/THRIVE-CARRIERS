/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  /* Theme is a choice, not a guess: the class is put on <html> from the
     stored preference, so "match my system" is one of three options rather
     than the only behaviour. */
  darkMode: "class",
  theme: { extend: {} },
  plugins: [],
};
