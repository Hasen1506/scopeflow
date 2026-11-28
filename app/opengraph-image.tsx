import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "ContractLock – Lock Terms, Check Traps & WhatsApp Proof";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "#0F1D55",
          color: "#F3EBD9",
          fontFamily: "Georgia, serif",
          border: "12px solid #192869",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "14px",
              border: "2px solid rgba(243,235,217,0.45)",
              background: "#192869",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "28px",
              fontWeight: 700,
              color: "#F3EBD9",
            }}
          >
            CL
          </div>
          <div style={{ fontSize: "34px", fontWeight: 600, letterSpacing: "-0.02em" }}>
            ContractLock
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "960px" }}>
          <div style={{ fontSize: "64px", fontWeight: 700, lineHeight: 1.08, letterSpacing: "-0.03em" }}>
            Lock clear terms before you pay.
          </div>
          <div style={{ fontSize: "28px", lineHeight: 1.4, color: "#DDD4BF", fontFamily: "sans-serif" }}>
            Check agreement traps, confirm vendor &amp; client scopes over WhatsApp, and keep tamper-proof receipts.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: "1px solid rgba(243,235,217,0.28)",
            paddingTop: "24px",
            fontSize: "20px",
            color: "#CFC6B0",
            fontFamily: "sans-serif",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          <span>Trap Check · Multi-Event Vendors · Tamper-Proof Proof</span>
          <span>contractlock.app</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
