// @refresh reset

import { useEffect, useRef, useState } from "react";
import * as vision from "@mediapipe/tasks-vision";

type Screen = "home" | "squat" | "history" | "progress" | "profile";
type CameraFacing = "user" | "environment";

type Stage =
  | "Calibrando"
  | "Aguardando corpo"
  | "Em pé"
  | "Descendo"
  | "Agachado"
  | "Subindo";

type Phase = "waiting" | "standing" | "descending" | "bottom" | "ascending";

type RepData = {
  depth: number;
  torso: number;
  hip: number;
  speed: number;
  score: number;
  depthScore: number;
  torsoScore: number;
  hipScore: number;
  speedScore: number;
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
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>("environment");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [status, setStatus] = useState("Carregando IA...");
  const [kneeAngle, setKneeAngle] = useState<number | null>(null);
  const [torsoAngle, setTorsoAngle] = useState<number | null>(null);
  const [hipMetric, setHipMetric] = useState<number | null>(null);
  const [speedSeconds, setSpeedSeconds] = useState<number | null>(null);

  const [stage, setStage] = useState<Stage>("Aguardando corpo");
  const [reps, setReps] = useState(0);
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState("Posicione o corpo inteiro na câmera.");
  const [sessionFinished, setSessionFinished] = useState(false);
  const [repHistory, setRepHistory] = useState<RepData[]>([]);
  const [, setSessionHistory] = useState<SessionData[]>([]);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [calibrated, setCalibrated] = useState(false);

  const phaseRef = useRef<Phase>("waiting");
  const lowestAngleRef = useRef(180);
  const lastRepTimeRef = useRef(0);
  const descentStartTimeRef = useRef(0);
  const sessionFinishedRef = useRef(false);
  const angleBufferRef = useRef<number[]>([]);
  const standingFramesRef = useRef(0);
  const bottomFramesRef = useRef(0);
  const returnStandingFramesRef = useRef(0);

  const calibrationFramesRef = useRef<number[]>([]);
  const calibratedRef = useRef(false);
  const baselineStandingAngleRef = useRef(170);
  const worstTorsoRef = useRef(0);
  const worstHipRef = useRef(0);

  useEffect(() => {
    sessionFinishedRef.current = sessionFinished;
  }, [sessionFinished]);

  useEffect(() => {
    calibratedRef.current = calibrated;
  }, [calibrated]);

  useEffect(() => {
    if (screen !== "squat") return;

    let poseLandmarker: any = null;
    let animationFrameId: number;

    async function start() {
      try {
        setStatus("Pedindo acesso à câmera...");

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: cameraFacing
          },
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

        setStatus(
          cameraFacing === "environment"
            ? "IA ativa 🔥 câmera traseira"
            : "IA ativa 🔥 câmera frontal"
        );

        detectPose();
      } catch (error: any) {
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

        const side = getBestSide(landmarks);

        if (!side) {
          resetMotionRefs();
          resetCalibration();

          setStage("Aguardando corpo");
          setFeedback("Fique totalmente de lado, em pé e parado para calibrar.");

          setKneeAngle(null);
          setTorsoAngle(null);
          setHipMetric(null);
          setScore(0);

          animationFrameId = requestAnimationFrame(detectPose);
          return;
        }

        const rawKneeAngle = Math.round(
          calculateAngle(side.hip, side.knee, side.ankle)
        );

        const avgKneeAngle = smoothAngle(rawKneeAngle);

        const avgTorsoAngle = Math.round(
          calculateTorsoAngle(side.shoulder, side.hip)
        );

        const hipValue = Math.round(
          calculateHipShift(side.hip, side.knee, side.ankle) * 100
        );

        setKneeAngle(avgKneeAngle);
        setTorsoAngle(avgTorsoAngle);
        setHipMetric(hipValue);

        const currentScoreParts = calculateScoreParts(
          avgKneeAngle,
          avgTorsoAngle,
          hipValue,
          null
        );

        setScore(currentScoreParts.total);

        if (!calibratedRef.current) {
          runCalibration(avgKneeAngle);
          animationFrameId = requestAnimationFrame(detectPose);
          return;
        }

        if (!sessionFinishedRef.current) {
          updateRepState(avgKneeAngle, avgTorsoAngle, hipValue);
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
  }, [screen, cameraFacing]);

  function switchCamera() {
    setCameraFacing((prev) => (prev === "user" ? "environment" : "user"));

    setKneeAngle(null);
    setTorsoAngle(null);
    setHipMetric(null);
    setScore(0);
    setSpeedSeconds(null);
    setFeedback("Trocando câmera...");
    resetMotionRefs();
    resetCalibration();
  }

  function getBestSide(landmarks: any[]) {
    const right = {
      shoulder: landmarks[12],
      hip: landmarks[24],
      knee: landmarks[26],
      ankle: landmarks[28]
    };

    const left = {
      shoulder: landmarks[11],
      hip: landmarks[23],
      knee: landmarks[25],
      ankle: landmarks[27]
    };

    const rightVisibility = averageVisibility([
      right.shoulder,
      right.hip,
      right.knee,
      right.ankle
    ]);

    const leftVisibility = averageVisibility([
      left.shoulder,
      left.hip,
      left.knee,
      left.ankle
    ]);

    if (rightVisibility < 0.35 && leftVisibility < 0.35) return null;

    return rightVisibility >= leftVisibility ? right : left;
  }

  function averageVisibility(points: any[]) {
    const valid = points.filter(
      (point) => point && point.visibility !== undefined
    );

    if (valid.length === 0) return 0;

    return (
      valid.reduce((acc, point) => acc + point.visibility, 0) / valid.length
    );
  }

  function runCalibration(angle: number) {
    setStage("Calibrando");

    if (angle < 155) {
      calibrationFramesRef.current = [];
      setCalibrationProgress(0);
      setFeedback("Fique em pé e parado de lado para calibrar a IA.");
      return;
    }

    calibrationFramesRef.current.push(angle);

    if (calibrationFramesRef.current.length > 45) {
      calibrationFramesRef.current.shift();
    }

    const progress = Math.round((calibrationFramesRef.current.length / 45) * 100);
    setCalibrationProgress(progress);
    setFeedback(`Calibrando IA... fique parado em pé (${progress}%).`);

    if (calibrationFramesRef.current.length >= 45) {
      const avg =
        calibrationFramesRef.current.reduce((acc, value) => acc + value, 0) /
        calibrationFramesRef.current.length;

      baselineStandingAngleRef.current = Math.round(avg);
      calibratedRef.current = true;
      setCalibrated(true);
      setCalibrationProgress(100);
      setStage("Em pé");
      setFeedback("Calibração concluída! Agora comece o agachamento.");
    }
  }

  function updateRepState(angle: number, torso: number, hip: number) {
    const now = Date.now();

    const standingThreshold = Math.max(160, baselineStandingAngleRef.current - 8);
    const startDescentThreshold = baselineStandingAngleRef.current - 25;

    if (angle > standingThreshold) standingFramesRef.current += 1;
    else standingFramesRef.current = 0;

    if (phaseRef.current === "waiting") {
      setStage("Aguardando corpo");
      setFeedback("Fique em pé de lado e enquadre o corpo inteiro.");

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

      if (angle < startDescentThreshold) {
        phaseRef.current = "descending";
        lowestAngleRef.current = angle;
        worstTorsoRef.current = torso;
        worstHipRef.current = hip;
        descentStartTimeRef.current = now;
      }

      return;
    }

    if (phaseRef.current === "descending") {
      setStage("Descendo");
      setFeedback("Continue descendo com controle.");

      if (angle < lowestAngleRef.current) {
        lowestAngleRef.current = angle;
        worstTorsoRef.current = torso;
        worstHipRef.current = hip;
      }

      if (angle <= 115) bottomFramesRef.current += 1;
      else bottomFramesRef.current = 0;

      if (bottomFramesRef.current >= 5) phaseRef.current = "bottom";

      if (angle > standingThreshold) {
        resetMotionRefs();
        phaseRef.current = "standing";
      }

      return;
    }

    if (phaseRef.current === "bottom") {
      setStage("Agachado");

      if (angle < lowestAngleRef.current) {
        lowestAngleRef.current = angle;
        worstTorsoRef.current = torso;
        worstHipRef.current = hip;
      }

      if (hip < 40) {
        setFeedback("Quadril foi muito para trás. Tente manter mais controle.");
      } else if (torso > 28) {
        setFeedback("Tente manter o peito mais aberto.");
      } else {
        setFeedback("Boa profundidade! Agora suba.");
      }

      if (angle > 125) phaseRef.current = "ascending";

      return;
    }

    if (phaseRef.current === "ascending") {
      setStage("Subindo");
      setFeedback("Suba mantendo controle.");

      if (angle > standingThreshold) returnStandingFramesRef.current += 1;
      else returnStandingFramesRef.current = 0;

      if (
        returnStandingFramesRef.current >= 8 &&
        lowestAngleRef.current <= 115 &&
        now - lastRepTimeRef.current > 1800
      ) {
        const finalDepth = lowestAngleRef.current;
        const durationSeconds = (now - descentStartTimeRef.current) / 1000;

        const finalTorso = worstTorsoRef.current;
        const finalHip = worstHipRef.current;

        const repScoreParts = calculateScoreParts(
          finalDepth,
          finalTorso,
          finalHip,
          durationSeconds
        );

        setSpeedSeconds(Number(durationSeconds.toFixed(1)));

        setReps((prev) => prev + 1);

        setRepHistory((prev) => [
          ...prev,
          {
            depth: finalDepth,
            torso: finalTorso,
            hip: finalHip,
            speed: Number(durationSeconds.toFixed(1)),
            score: repScoreParts.total,
            depthScore: repScoreParts.depthScore,
            torsoScore: repScoreParts.torsoScore,
            hipScore: repScoreParts.hipScore,
            speedScore: repScoreParts.speedScore
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

  function calculateHipShift(hip: any, knee: any, ankle: any) {
    const bodyScale = Math.abs(hip.y - ankle.y) || 0.1;

    const hipBehindKnee = Math.abs(hip.x - knee.x);
    const hipBehindAnkle = Math.abs(hip.x - ankle.x);

    return Math.max(hipBehindKnee, hipBehindAnkle) / bodyScale;
  }

  function calculateScoreParts(
    knee: number,
    torso: number,
    hip: number,
    durationSeconds: number | null
  ) {
    let depthScore = 0;
    let torsoScore = 0;
    let hipScore = 0;
    let speedScore = 0;

    if (knee <= 85) depthScore = 40;
    else if (knee <= 95) depthScore = 34;
    else if (knee <= 105) depthScore = 24;
    else if (knee <= 115) depthScore = 12;
    else if (knee <= 130) depthScore = 4;
    else depthScore = 0;

    if (torso <= 12) torsoScore = 25;
    else if (torso <= 17) torsoScore = 20;
    else if (torso <= 22) torsoScore = 13;
    else if (torso <= 30) torsoScore = 6;
    else torsoScore = 2;

    if (hip >= 100) hipScore = 20;
    else if (hip >= 80) hipScore = 15;
    else if (hip >= 60) hipScore = 9;
    else if (hip >= 40) hipScore = 4;
    else hipScore = 0;

    if (durationSeconds === null) {
      speedScore = 15;
    } else if (durationSeconds >= 2.2 && durationSeconds <= 5.0) {
      speedScore = 15;
    } else if (durationSeconds >= 1.6 && durationSeconds < 2.2) {
      speedScore = 10;
    } else if (durationSeconds > 5.0 && durationSeconds <= 7.0) {
      speedScore = 10;
    } else if (durationSeconds >= 1.1 && durationSeconds < 1.6) {
      speedScore = 5;
    } else {
      speedScore = 2;
    }

    return {
      depthScore,
      torsoScore,
      hipScore,
      speedScore,
      total: depthScore + torsoScore + hipScore + speedScore
    };
  }

  function resetCalibration() {
    calibrationFramesRef.current = [];
    calibratedRef.current = false;
    setCalibrated(false);
    setCalibrationProgress(0);
  }

  function resetMotionRefs() {
    phaseRef.current = "waiting";
    lowestAngleRef.current = 180;
    standingFramesRef.current = 0;
    bottomFramesRef.current = 0;
    returnStandingFramesRef.current = 0;
    angleBufferRef.current = [];
    descentStartTimeRef.current = 0;
    worstTorsoRef.current = 0;
    worstHipRef.current = 0;
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

    const radians = Math.atan2(dx, Math.abs(dy));
    return Math.abs((radians * 180) / Math.PI);
  }

  const averageScore =
    repHistory.length > 0
      ? Math.round(
          repHistory.reduce((acc, rep) => acc + rep.score, 0) /
            repHistory.length
        )
      : 0;

  const averageDepth =
    repHistory.length > 0
      ? Math.round(
          repHistory.reduce((acc, rep) => acc + rep.depth, 0) /
            repHistory.length
        )
      : 0;

  const averageDepthScore =
    repHistory.length > 0
      ? Math.round(
          repHistory.reduce((acc, rep) => acc + rep.depthScore, 0) /
            repHistory.length
        )
      : 0;

  const averageTorsoScore =
    repHistory.length > 0
      ? Math.round(
          repHistory.reduce((acc, rep) => acc + rep.torsoScore, 0) /
            repHistory.length
        )
      : 0;

  const averageHipScore =
    repHistory.length > 0
      ? Math.round(
          repHistory.reduce((acc, rep) => acc + rep.hipScore, 0) /
            repHistory.length
        )
      : 0;

  const averageSpeedScore =
    repHistory.length > 0
      ? Math.round(
          repHistory.reduce((acc, rep) => acc + rep.speedScore, 0) /
            repHistory.length
        )
      : 0;

  const averageSpeed =
    repHistory.length > 0
      ? Number(
          (
            repHistory.reduce((acc, rep) => acc + rep.speed, 0) /
            repHistory.length
          ).toFixed(1)
        )
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
    setSpeedSeconds(null);
    resetMotionRefs();
    resetCalibration();
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
    resetCalibration();
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
        <p style={{ color: "#A1A1AA" }}>As séries finalizadas aparecem aqui.</p>
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

        <button onClick={switchCamera} style={switchCameraButtonStyle}>
          🔄 Câmera
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
            <InfoCard title="Quadril" value={hipMetric !== null ? `${hipMetric}` : "--"} />
            <InfoCard title="Tempo" value={speedSeconds ? `${speedSeconds}s` : "--"} />
          </div>

          {!calibrated && (
            <div
              style={{
                height: 8,
                background: "#0F172A",
                borderRadius: 999,
                overflow: "hidden",
                marginBottom: 10
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${calibrationProgress}%`,
                  background: "#3B82F6"
                }}
              />
            </div>
          )}

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
              <div>Tempo médio: {averageSpeed}s</div>

              <div style={{ marginTop: 10 }}>
                <strong>Detalhamento da nota:</strong>
              </div>

              <div>Profundidade: {averageDepthScore}/40</div>
              <div>Tronco: {averageTorsoScore}/25</div>
              <div>Quadril: {averageHipScore}/20</div>
              <div>Velocidade: {averageSpeedScore}/15</div>

              <button
                onClick={() => {
                  setReps(0);
                  setRepHistory([]);
                  setSessionFinished(false);
                  setFeedback("Nova série iniciada 🔥");
                  setScore(0);
                  setSpeedSeconds(null);
                  resetMotionRefs();
                  resetCalibration();
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

function NavButton({ icon, label, active, onClick }: any) {
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
        fontSize: 12
      }}
    >
      <span>{icon}</span>
      {label}
    </button>
  );
}

function ExerciseCard({ name, emoji, active, available, onClick }: any) {
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
        minHeight: 110
      }}
    >
      <div style={{ fontSize: 28 }}>{emoji}</div>
      <div style={{ fontWeight: "bold", marginTop: 10 }}>{name}</div>
      <div style={{ color: available ? "#60A5FA" : "#A1A1AA", fontSize: 12 }}>
        {available ? "Disponível" : "Em breve"}
      </div>
    </button>
  );
}

function InfoCard({ title, value }: { title: string; value: string }) {
  return (
    <div style={{ background: "#0F172A", border: "1px solid #1E293B", borderRadius: 12, padding: 8 }}>
      <div style={{ color: "#A1A1AA", fontSize: 11 }}>{title}</div>
      <div style={{ fontWeight: "bold", fontSize: 14, marginTop: 4 }}>{value}</div>
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
  padding: 24
};

const primaryButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: 14,
  borderRadius: 14,
  border: "none",
  background: "#2563EB",
  color: "white",
  fontWeight: "bold",
  marginTop: 18
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
  fontWeight: "bold"
};

const switchCameraButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: 18,
  right: 18,
  zIndex: 10,
  background: "#111827",
  color: "white",
  border: "1px solid #3B82F6",
  borderRadius: 14,
  padding: "10px 14px",
  fontWeight: "bold"
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