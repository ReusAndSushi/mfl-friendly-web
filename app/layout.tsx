export const metadata = {
  title: "MFL Friendly Bot",
  description: "Find MFL clubs with a similar starting-XI rating and track auto-played friendlies.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#0b0b0c", color: "#eaeaea" }}>
        {children}
      </body>
    </html>
  );
}
