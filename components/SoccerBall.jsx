/*
 * Classic soccer-ball icon — renders the shared asset at /public/soccerball.svg
 * (a platform-independent replacement for the ⚽ emoji, which renders blue on
 * Windows). Edit public/soccerball.svg to change the ball everywhere. No hooks,
 * so it works in both server and client components.
 */

export const SOCCER_BALL_SRC = "/soccerball.svg";

export default function SoccerBall({ className, style }) {
  return (
    <img
      src={SOCCER_BALL_SRC}
      alt=""
      aria-hidden="true"
      draggable="false"
      className={"soccer-ball" + (className ? " " + className : "")}
      style={style}
    />
  );
}
