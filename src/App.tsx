import { useEffect, useRef, useState } from "react";
import * as vision from "@mediapipe/tasks-vision";

type Stage = "Aguardando corpo" | "Em pé" | "Descendo" | "Agachado";

type RepData = {
  depth: number;
  torso: number;
  alignment: number;
  score: number;
};

export default function App() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [status, setStatus] = useState("Carregando IA...");
  const [kneeAngle, setKneeAngle] = useState<number | null>(null);
  const [torsoAngle, setTorsoAngle] = useState<number | null>(null);
  const [kneeAlignment, setKneeAlignment] = useState("--");
  const [stage, setStage] = useState<Stage>("Aguardando corpo");
  const [reps, setReps] = useState(0);
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState("Posicione o corpo inteiro na câmera.");
  const [sessionFinished, setSessionFinished] = useState(false);
  const [repHistory, setRepHistory] = useState<RepData[]>([]);

  const validDepthRef = useRef(false);
  const lowestAngleRef = useRef(180);
  const lastRepTimeRef = useRef(0);
  const sessionFinishedRef = useRef(false);

  useEffect(() => {
    sessionFinishedRef.current = sessionFinished;
  }, [sessionFinished]);

  useEffect(() => {
    let poseLandmarker: any = null;
    let animationFrameId: number;

    async function start() {
      try {
        setStatus("Pedindo acesso à câmera...");

        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false
        });

        if (!videoRef.current) return;

        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        setStatus("Carregando modelo corporal...");

        const fileset = await vision.FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );

        poseLandmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
            delegate: "CPU"
          },
          runningMode: "VIDEO",
          numPoses: 1
        });

        setStatus("IA ativa 🔥");
        detectPose();
      } catch (error: any) {
        console.error(error);
        setStatus(`Erro: ${error?.message || "falha ao iniciar câmera ou IA"}`);
      }
    }

    function detectPose() {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (!video || !canvas || !poseLandmarker) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      if (video.videoWidth === 0 || video.videoHeight === 0) {
        animationFrameId = requestAnimationFrame(detectPose);
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const results = poseLandmarker.detectForVideo(video, performance.now());

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const drawingUtils = new vision.DrawingUtils(ctx);

      if (results.landmarks && results.landmarks.length > 0) {
        const landmarks = results.landmarks[0];

        drawingUtils.drawConnectors(
          landmarks,
          vision.PoseLandmarker.POSE_CONNECTIONS,
          { color: "#3B82F6", lineWidth: 4 }
        );

        drawingUtils.drawLandmarks(landmarks, {
          color: "#FFFFFF",
          lineWidth: 2,
          radius: 4
        });

        const avgKneeAngle = Math.round(
          (calculateAngle(landmarks[23], landmarks[25], landmarks[27]) +
            calculateAngle(landmarks[24], landmarks[26], landmarks[28])) /
            2
        );

        const avgTorsoAngle = Math.round(
          (calculateTorsoAngle(landmarks[11], landmarks[23]) +
            calculateTorsoAngle(landmarks[12], landmarks[24])) /
            2
        );

        const alignmentScore = calculateKneeAlignment(
          landmarks[23],
          landmarks[24],
          landmarks[25],
          landmarks[26],
          landmarks[27],
          landmarks[28]
        );

        const alignmentLabel =
          alignmentScore >= 80
            ? "Bom"
            : alignmentScore >= 55
            ? "Atenção"
            : "Fechando";

        setKneeAngle(avgKneeAngle);
        setTorsoAngle(avgTorsoAngle);
        setKneeAlignment(alignmentLabel);

        if (avgKneeAngle < lowestAngleRef.current) {
          lowestAngleRef.current = avgKneeAngle;
        }

        const currentScore = calculateScore(
          avgKneeAngle,
          avgTorsoAngle,
          alignmentScore
        );

        setScore(currentScore);

        const now = Date.now();

        if (!sessionFinishedRef.current) {
          if (avgKneeAngle > 160) {
            setStage("Em pé");

            if (validDepthRef.current && now - lastRepTimeRef.current > 1200) {
              setReps((prev) => prev + 1);

              setRepHistory((prev) => [
                ...prev,
                {
                  depth: lowestAngleRef.current,
                  torso: avgTorsoAngle,
                  alignment: alignmentScore,
                  score: currentScore
                }
              ]);

              lastRepTimeRef.current = now;
              validDepthRef.current = false;
              lowestAngleRef.current = 180;

              setFeedback("Boa repetição!");
            } else {
              setFeedback("Boa posição inicial. Desça com controle.");
            }
          } else if (avgKneeAngle <= 160 && avgKneeAngle > 120) {
            setStage("Descendo");
            setFeedback("Continue descendo...");
          } else if (avgKneeAngle <= 120) {
            setStage("Agachado");
            validDepthRef.current = true;

            if (alignmentScore < 55) {
              setFeedback("Joelhos estão fechando.");
            } else if (avgTorsoAngle > 35) {
              setFeedback("Tente manter o peito mais aberto.");
            } else {
              setFeedback("Boa profundidade! Agora suba.");
            }
          }
        }
      } else {
        setKneeAngle(null);
        setTorsoAngle(null);
        setKneeAlignment("--");
        setStage("Aguardando corpo");
        setScore(0);
        setFeedback("Posicione o corpo inteiro na câmera.");
      }

      animationFrameId = requestAnimationFrame(detectPose);
    }

    start();

    return () => {
      cancelAnimationFrame(animationFrameId);

      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
      }

      if (poseLandmarker) {
        poseLandmarker.close();
      }
    };
  }, []);

  function calculateAngle(a: any, b: any, c: any) {
    const radians =
      Math.atan2(c.y - b.y, c.x - b.x) -
      Math.atan2(a.y - b.y, a.x - b.x);

    let angle = Math.abs((radians * 180) / Math.PI);

    if (angle > 180) {
      angle = 360 - angle;
    }

    return angle;
  }

  function calculateTorsoAngle(shoulder: any, hip: any) {
    const dx = shoulder.x - hip.x;
    const dy = shoulder.y - hip.y;
    const radians = Math.atan2(Math.abs(dx), Math.abs(dy));

    return (radians * 180) / Math.PI;
  }

  function calculateKneeAlignment(
    leftHip: any,
    rightHip: any,
    leftKnee: any,
    rightKnee: any,
    leftAnkle: any,
    rightAnkle: any
  ) {
    const hipWidth = Math.abs(leftHip.x - rightHip.x);
    const kneeWidth = Math.abs(leftKnee.x - rightKnee.x);
    const ankleWidth = Math.abs(leftAnkle.x - rightAnkle.x);

    if (hipWidth === 0 || ankleWidth === 0) return 50;

    const expectedWidth = (hipWidth + ankleWidth) / 2;
    const ratio = kneeWidth / expectedWidth;

    if (ratio >= 0.9) return 100;
    if (ratio >= 0.8) return 80;
    if (ratio >= 0.7) return 60;
    if (ratio >= 0.6) return 40;

    return 20;
  }

  function calculateScore(knee: number, torso: number, alignment: number) {
    let depthScore = 0;
    let torsoScore = 0;
    let alignmentFinal = 0;

    if (knee <= 95) depthScore = 45;
    else if (knee <= 105) depthScore = 42;
    else if (knee <= 120) depthScore = 35;
    else if (knee <= 140) depthScore = 20;
    else depthScore = 10;

    if (torso <= 20) torsoScore = 30;
    else if (torso <= 30) torsoScore = 24;
    else if (torso <= 40) torsoScore = 16;
    else torsoScore = 8;

    if (alignment >= 80) alignmentFinal = 25;
    else if (alignment >= 55) alignmentFinal = 15;
    else alignmentFinal = 5;

    return depthScore + torsoScore + alignmentFinal;
  }

  const averageScore =
    repHistory.length > 0
      ? Math.round(repHistory.reduce((acc, rep) => acc + rep.score, 0) / repHistory.length)
      : 0;

  const averageDepth =
    repHistory.length > 0
      ? Math.round(repHistory.reduce((acc, rep) => acc + rep.depth, 0) / repHistory.length)
      : 0;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0B0F19",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: 20,
        color: "white",
        fontFamily: "Arial"
      }}
    >
      <div
        style={{
          width: 360,
          height: 740,
          borderRadius: 24,
          overflow: "hidden",
          border: "3px solid #2563EB",
          background: "black",
          position: "relative"
        }}
      >
        <video ref={videoRef} playsInline muted style={{ display: "none" }} />

        <canvas
          ref={canvasRef}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover"
          }}
        />

        <div
          style={{
            position: "absolute",
            top: 18,
            left: 18,
            right: 18,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}
        >
          <div style={{ fontSize: 22, fontWeight: "bold" }}>
            Move<span style={{ color: "#3B82F6" }}>Up</span> AI 🔥
          </div>

          <div
            style={{
              background: "rgba(37,99,235,0.9)",
              padding: "8px 12px",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: "bold"
            }}
          >
            Reps: {reps}
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            bottom: 18,
            left: 18,
            right: 18,
            background: "rgba(17,24,39,0.92)",
            padding: 14,
            borderRadius: 16
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 8,
              marginBottom: 10
            }}
          >
            <InfoCard title="Status" value={stage} />
            <InfoCard title="Joelho" value={kneeAngle ? `${kneeAngle}°` : "--"} />
            <InfoCard title="Score" value={`${score}`} />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 8,
              marginBottom: 10
            }}
          >
            <InfoCard title="Tronco" value={torsoAngle ? `${torsoAngle}°` : "--"} />
            <InfoCard title="Joelhos" value={kneeAlignment} />
            <InfoCard title="Média" value={`${averageScore}`} />
          </div>

          <div
            style={{
              color: "#60A5FA",
              fontWeight: "bold",
              fontSize: 14,
              marginBottom: 10
            }}
          >
            {feedback}
          </div>

          {!sessionFinished ? (
            <button
              onClick={() => setSessionFinished(true)}
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 12,
                border: "none",
                background: "#2563EB",
                color: "white",
                fontWeight: "bold",
                marginBottom: 10
              }}
            >
              Finalizar Série
            </button>
          ) : (
            <div
              style={{
                background: "#0F172A",
                padding: 12,
                borderRadius: 12,
                marginTop: 10
              }}
            >
              <div style={{ fontWeight: "bold", marginBottom: 8 }}>
                🏋️ Resultado Final
              </div>

              <div>Repetições: {reps}</div>
              <div>Score médio: {averageScore}</div>
              <div>Profundidade média: {averageDepth}°</div>

              <div style={{ marginTop: 10, color: "#60A5FA" }}>
                {averageScore >= 85
                  ? "Excelente execução!"
                  : averageScore >= 70
                  ? "Boa execução!"
                  : "Continue treinando para melhorar sua técnica."}
              </div>

              <button
                onClick={() => {
                  setReps(0);
                  setRepHistory([]);
                  setSessionFinished(false);
                  setFeedback("Nova série iniciada 🔥");
                  setScore(0);
                  validDepthRef.current = false;
                  lowestAngleRef.current = 180;
                  lastRepTimeRef.current = Date.now();
                }}
                style={{
                  width: "100%",
                  padding: 12,
                  borderRadius: 12,
                  border: "none",
                  background: "#16A34A",
                  color: "white",
                  fontWeight: "bold",
                  marginTop: 14
                }}
              >
                Nova Série
              </button>
            </div>
          )}

          <div
            style={{
              color: "#A1A1AA",
              fontSize: 12,
              marginTop: 8
            }}
          >
            {status}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoCard({ title, value }: { title: string; value: string }) {
  return (
    <div
      style={{
        background: "#0F172A",
        border: "1px solid #1E293B",
        borderRadius: 12,
        padding: 8
      }}
    >
      <div style={{ color: "#A1A1AA", fontSize: 11 }}>{title}</div>
      <div style={{ fontWeight: "bold", fontSize: 14, marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}