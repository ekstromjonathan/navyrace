import React from "react";
import { createRoot } from "react-dom/client";
import WorkoutApp from "./WorkoutApp.jsx";
import "./workout.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <WorkoutApp />
  </React.StrictMode>,
);
