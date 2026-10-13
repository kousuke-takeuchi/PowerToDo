import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: ["@storybook/addon-docs"],
  framework: "@storybook/react-vite",
  // Storybook 自身のバンドル (docs の syntax highlighter 等) が 500 kB を超えるため警告を止める
  viteFinal: async (config) => {
    config.build = { ...config.build, chunkSizeWarningLimit: 4000 };
    return config;
  },
};
export default config;
