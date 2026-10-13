import type { Preview } from "@storybook/react-vite";
import "../src/styles/index.css";

const viewports = {
  desktop: { name: "Desktop 1440", styles: { width: "1440px", height: "900px" }, type: "desktop" },
  min: { name: "Min 960", styles: { width: "960px", height: "600px" }, type: "desktop" },
  mobile: { name: "Mobile 390", styles: { width: "390px", height: "844px" }, type: "mobile" },
} as const;

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "テーマ",
      toolbar: { title: "Theme", icon: "mirror", items: ["light", "dark"], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: "light", viewport: { value: "desktop", isRotated: false } },
  parameters: {
    viewport: { options: viewports },
    options: { storySort: { order: ["Screens", ["Desktop", "Dark", "Mobile"], "Components", "Foundation"] } },
    layout: "fullscreen",
    backgrounds: { disable: true },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  decorators: [
    (Story, ctx) => {
      document.documentElement.setAttribute("data-theme", ctx.globals.theme ?? "light");
      return Story();
    },
  ],
};
export default preview;
