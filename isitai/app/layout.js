import "./globals.css";

export const metadata = {
  title: "IsItAI — AI Image Detector",
  description: "Detect AI-generated images instantly using ensemble AI models and EXIF forensics.",
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/favicon.svg',
  }
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}