declare module "screenshot-desktop" {
  type DisplayInfo = {
    id: string;
    name?: string;
    top: number;
    right?: number;
    bottom?: number;
    left: number;
    width?: number;
    height?: number;
    dpiScale?: number;
  };

  type Options = {
    screen?: string;
    format?: "jpg" | "jpeg" | "png" | "bmp";
    filename?: string;
  };

  interface ScreenshotDesktop {
    (options?: Options): Promise<Buffer>;
    listDisplays: () => Promise<DisplayInfo[]>;
  }

  const screenshotDesktop: ScreenshotDesktop;
  export = screenshotDesktop;
}
