// @refresh reset

import { useEffect, useRef, useState } from "react";
import * as vision from "@mediapipe/tasks-vision";

type Screen = "home" | "squat" | "history" | "progress" | "profile";
type Stage = "Aguardando corpo" | "Em pé" | "Descendo" | "Agachado" | "Subindo";
type Phase = "waiting" | "standing" | "descending" | "bottom" | "ascending";

type RepData = {
  depth: number;
  torso: number;
  alignment: number;
  score: number;
};

type SessionData = {
  reps: number;
  averageScore: number;
  averageDepth: number;
  date: string;
};

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [selectedExercise, setSelectedExercise] = useState("Agachamento");

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
  const [sessionHistory, setSessionHistory] = useState<SessionData[]>([]);

  const phaseRef = useRef<Phase>("waiting");
  const lowestAngleRef = useRef(180);
  const lastRepTimeRef = useRef(0);
  const sessionFinishedRef = useRef(false);
  const angleBufferRef = useRef<number[]>([]);
  const standingFramesRef = useRef(0);
  const bottomFramesRef = useRef(0);
  const returnStandingFramesRef = useRef(0);

  useEffect(() => {
    sessionFinishedRef.current = sessionFinished;
  }, [sessionFinished]);

  useEffect(() => {
    if (screen !== "squat") return;

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

        if (!isFullBodyVisible(landmarks)) {
          resetMotionRefs();
          setStage("Aguardando corpo");
          setFeedback("Afaste o celular até aparecer corpo inteiro.");
          setKneeAngle(null);
          setTorsoAngle(null);
          setKneeAlignment("--");
          setScore(0);
          animationFrameId = requestAnimationFrame(detectPose);
          return;
        }

        const rawKneeAngle = Math.round(
          (calculateAngle(landmarks[23], landmarks[25], landmarks[27]) +
            calculateAngle(landmarks[24], landmarks[26], landmarks[28])) /
            2
        );

        const avgKneeAngle = smoothAngle(rawKneeAngle);

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
          alignmentScore >= 80 ? "Bom" : alignmentScore >= 55 ? "Atenção" : "Fechando";

        setKneeAngle(avgKneeAngle);
        setTorsoAngle(avgTorsoAngle);
        setKneeAlignment(alignmentLabel);

        const currentScore = calculateScore(avgKneeAngle, avgTorsoAngle, alignmentScore);
        setScore(currentScore);

        if (!sessionFinishedRef.current) {
          updateRepState(avgKneeAngle, avgTorsoAngle, alignmentScore, currentScore);
        }
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
  }, [screen]);

  function updateRepState(angle: number, torso: number, alignment: number, currentScore: number) {
    const now = Date.now();

    if (angle > 165) standingFramesRef.current += 1;
    else standingFramesRef.current = 0;

    if (phaseRef.current === "waiting") {
      setStage("Aguardando corpo");
      setFeedback("Fique em pé e enquadre o corpo inteiro.");

      if (standingFramesRef.current >= 12) {
        phaseRef.current = "standing";
        setStage("Em pé");
        setFeedback("Boa posição inicial. Agora desça com controle.");
      }

      return;
    }

    if (phaseRef.current === "standing") {
      setStage("Em pé");
      setFeedback("Boa posição inicial. Agora desça com controle.");

      if (angle < 145) {
        phaseRef.current = "descending";
        lowestAngleRef.current = angle;
      }

      return;
    }

    if (phaseRef.current === "descending") {
      setStage("Descendo");
      setFeedback("Continue descendo...");

      if (angle < lowestAngleRef.current) lowestAngleRef.current = angle;

      if (angle <= 120) bottomFramesRef.current += 1;
      else bottomFramesRef.current = 0;

      if (bottomFramesRef.current >= 5) phaseRef.current = "bottom";

      if (angle > 165) {
        resetMotionRefs();
        phaseRef.current = "standing";
      }

      return;
    }

    if (phaseRef.current === "bottom") {
      setStage("Agachado");

      if (angle < lowestAngleRef.current) lowestAngleRef.current = angle;

      if (alignment < 55) setFeedback("Joelhos estão fechando.");
      else if (torso > 35) setFeedback("Tente manter o peito mais aberto.");
      else setFeedback("Boa profundidade! Agora suba.");

      if (angle > 125) phaseRef.current = "ascending";

      return;
    }

    if (phaseRef.current === "ascending") {
      setStage("Subindo");
      setFeedback("Suba mantendo controle.");

      if (angle > 165) returnStandingFramesRef.current += 1;
      else returnStandingFramesRef.current = 0;

      if (
        returnStandingFramesRef.current >= 8 &&
        lowestAngleRef.current <= 120 &&
        now - lastRepTimeRef.current > 1800
      ) {
        setReps((prev) => prev + 1);

        setRepHistory((prev) => [
          ...prev,
          {
            depth: lowestAngleRef.current,
            torso,
            alignment,
            score: currentScore
          }
        ]);

        lastRepTimeRef.current = now;
        resetMotionRefs();
        phaseRef.current = "standing";
        setStage("Em pé");
        setFeedback("Boa repetição!");
      }
    }
  }

  function resetMotionRefs() {
    phaseRef.current = "waiting";
    lowestAngleRef.current = 180;
    standingFramesRef.current = 0;
    bottomFramesRef.current = 0;
    returnStandingFramesRef.current = 0;
    angleBufferRef.current = [];
  }

  function isFullBodyVisible(landmarks: any[]) {
    const importantPoints = [11, 12, 23, 24, 25, 26, 27, 28];

    return importantPoints.every((index) => {
      const point = landmarks[index];
      return point && point.visibility !== undefined && point.visibility > 0.55;
    });
  }

  function smoothAngle(angle: number) {
    angleBufferRef.current.push(angle);

    if (angleBufferRef.current.length > 8) {
      angleBufferRef.current.shift();
    }

    const sum = angleBufferRef.current.reduce((acc, value) => acc + value, 0);
    return Math.round(sum / angleBufferRef.current.length);
  }

  function calculateAngle(a: any, b: any, c: any) {
    const radians =
      Math.atan2(c.y - b.y, c.x - b.x) -
      Math.atan2(a.y - b.y, a.x - b.x);

    let angle = Math.abs((radians * 180) / Math.PI);
    if (angle > 180) angle = 360 - angle;

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

  function startExercise() {
    if (selectedExercise !== "Agachamento") {
      alert("Esse exercício ainda está em desenvolvimento 🚧");
      return;
    }

    setScreen("squat");
    setReps(0);
    setRepHistory([]);
    setSessionFinished(false);
    setFeedback("Posicione o corpo inteiro na câmera.");
    setScore(0);
    resetMotionRefs();
  }

  function finishSession() {
    setSessionFinished(true);

    if (repHistory.length > 0) {
      const newSession: SessionData = {
        reps,
        averageScore,
        averageDepth,
        date: new Date().toLocaleDateString("pt-BR")
      };

      setSessionHistory((prev) => [newSession, ...prev]);
    }
  }

  function goHome() {
    setScreen("home");
    resetMotionRefs();
  }

  if (screen === "home") {
    return (
      <AppLayout active="home" setScreen={setScreen}>
        <h1 style={{ margin: 0, fontSize: 34 }}>
          Move<span style={{ color: "#3B82F6" }}>Up</span>
        </h1>

        <p style={{ color: "#A1A1AA", marginTop: 8 }}>
          Escolha seu exercício e treine com mais confiança.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            marginTop: 24
          }}
        >
          <ExerciseCard
            name="Agachamento"
            emoji="🏋️"
            active={selectedExercise === "Agachamento"}
            available
            onClick={() => setSelectedExercise("Agachamento")}
          />

          <ExerciseCard
            name="Flexão"
            emoji="💪"
            active={selectedExercise === "Flexão"}
            available={false}
            onClick={() => setSelectedExercise("Flexão")}
          />

          <ExerciseCard
            name="Prancha"
            emoji="🧘"
            active={selectedExercise === "Prancha"}
            available={false}
            onClick={() => setSelectedExercise("Prancha")}
          />

          <ExerciseCard
            name="Corrida"
            emoji="🏃"
            active={selectedExercise === "Corrida"}
            available={false}
            onClick={() => setSelectedExercise("Corrida")}
          />
        </div>

        <button onClick={startExercise} style={primaryButtonStyle}>
          Iniciar {selectedExercise}
        </button>
      </AppLayout>
    );
  }

  if (screen === "history") {
    return (
      <AppLayout active="history" setScreen={setScreen}>
        <h1>📊 Histórico</h1>

        {sessionHistory.length === 0 ? (
          <p style={{ color: "#A1A1AA" }}>
            Nenhuma série finalizada ainda.
          </p>
        ) : (
          sessionHistory.map((item, index) => (
            <div key={index} style={listCardStyle}>
              <strong>{item.date}</strong>
              <p>Reps: {item.reps}</p>
              <p>Score médio: {item.averageScore}</p>
              <p>Profundidade média: {item.averageDepth}°</p>
            </div>
          ))
        )}
      </AppLayout>
    );
  }

  if (screen === "progress") {
    return (
      <AppLayout active="progress" setScreen={setScreen}>
        <h1>📈 Evolução</h1>

        <div style={listCardStyle}>
          <p style={{ color: "#A1A1AA" }}>Score médio atual</p>
          <h2>{averageScore || 0}</h2>
        </div>

        <div style={listCardStyle}>
          <p style={{ color: "#A1A1AA" }}>Total de séries salvas</p>
          <h2>{sessionHistory.length}</h2>
        </div>
      </AppLayout>
    );
  }

  if (screen === "profile") {
    return (
      <AppLayout active="profile" setScreen={setScreen}>
        <h1>👤 Perfil</h1>

        <div style={listCardStyle}>
          <p>Usuário: Felipe</p>
          <p>Nível: Iniciante</p>
          <p>Objetivo: melhorar execução</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <div style={pageStyle}>
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

        <button onClick={goHome} style={homeButtonStyle}>
          ← Tela inicial
        </button>

        <div
          style={{
            position: "absolute",
            top: 70,
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
          <div style={gridStyle}>
            <InfoCard title="Status" value={stage} />
            <InfoCard title="Joelho" value={kneeAngle ? `${kneeAngle}°` : "--"} />
            <InfoCard title="Score" value={`${score}`} />
          </div>

          <div style={gridStyle}>
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
            <button onClick={finishSession} style={primaryButtonStyle}>
              Finalizar Série
            </button>
          ) : (
            <div style={listCardStyle}>
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
                  resetMotionRefs();
                  lastRepTimeRef.current = Date.now();
                }}
                style={{
                  ...primaryButtonStyle,
                  background: "#16A34A",
                  marginTop: 14
                }}
              >
                Nova Série
              </button>
            </div>
          )}

          <div style={{ color: "#A1A1AA", fontSize: 12, marginTop: 8 }}>
            {status}
          </div>
        </div>
      </div>
    </div>
  );
}

function AppLayout({
  children,
  active,
  setScreen
}: {
  children: React.ReactNode;
  active: Screen;
  setScreen: (screen: Screen) => void;
}) {
  return (
    <div style={pageStyle}>
      <div style={homeCardStyle}>
        {children}
        <BottomNav active={active} setScreen={setScreen} />
      </div>
    </div>
  );
}

function BottomNav({
  active,
  setScreen
}: {
  active: Screen;
  setScreen: (screen: Screen) => void;
}) {
  return (
    <div style={bottomNavStyle}>
      <NavButton icon="🏠" label="Home" active={active === "home"} onClick={() => setScreen("home")} />
      <NavButton icon="📊" label="Histórico" active={active === "history"} onClick={() => setScreen("history")} />
      <NavButton icon="📈" label="Evolução" active={active === "progress"} onClick={() => setScreen("progress")} />
      <NavButton icon="👤" label="Perfil" active={active === "profile"} onClick={() => setScreen("profile")} />
    </div>
  );
}

function NavButton({
  icon,
  label,
  active,
  onClick
}: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        color: active ? "#60A5FA" : "#A1A1AA",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        fontSize: 12,
        cursor: "pointer"
      }}
    >
      <span>{icon}</span>
      {label}
    </button>
  );
}

function ExerciseCard({
  name,
  emoji,
  active,
  available,
  onClick
}: {
  name: string;
  emoji: string;
  active: boolean;
  available: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? "#1E293B" : "#0F172A",
        border: active ? "2px solid #3B82F6" : "1px solid #1E293B",
        borderRadius: 18,
        padding: 16,
        color: "white",
        textAlign: "left",
        minHeight: 110,
        position: "relative",
        cursor: "pointer"
      }}
    >
      <div style={{ fontSize: 28 }}>{emoji}</div>
      <div style={{ fontWeight: "bold", marginTop: 10 }}>{name}</div>
      <div
        style={{
          color: available ? "#60A5FA" : "#A1A1AA",
          fontSize: 12,
          marginTop: 4
        }}
      >
        {available ? "Disponível" : "Em breve"}
      </div>
    </button>
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

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#0B0F19",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: 20,
  color: "white",
  fontFamily: "Arial"
};

const homeCardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 420,
  background: "#111827",
  borderRadius: 28,
  padding: 24,
  boxShadow: "0 0 30px rgba(0,0,0,0.35)"
};

const primaryButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: 14,
  borderRadius: 14,
  border: "none",
  background: "#2563EB",
  color: "white",
  fontWeight: "bold",
  marginTop: 18,
  cursor: "pointer"
};

const homeButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: 18,
  left: 18,
  zIndex: 10,
  background: "#2563EB",
  color: "white",
  border: "none",
  borderRadius: 14,
  padding: "10px 14px",
  fontWeight: "bold",
  cursor: "pointer",
  boxShadow: "0 0 18px rgba(37,99,235,0.45)"
};

const bottomNavStyle: React.CSSProperties = {
  marginTop: 28,
  borderTop: "1px solid #1E293B",
  paddingTop: 16,
  display: "flex",
  justifyContent: "space-around"
};

const listCardStyle: React.CSSProperties = {
  background: "#0F172A",
  border: "1px solid #1E293B",
  borderRadius: 16,
  padding: 14,
  marginTop: 12
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr",
  gap: 8,
  marginBottom: 10
};