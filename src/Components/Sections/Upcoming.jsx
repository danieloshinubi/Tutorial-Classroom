import React, { useEffect, useState } from "react";

const Upcoming = () => {
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  const UpcomingStyle = {
    padding: "1%",
    display: "flex",
    border: "1px solid black",
    flexDirection: "column",
    width: "20%",
    borderRadius: "20px",
    buttonStyle: {
      width: "50%",
      padding: "4%",
      fontFamily: "inherit",
      borderRadius: "20px",
      cursor: "pointer",
      border: "none",
      buttonSpan: {
        display: "flex",
        justifyContent: "flex-end",
      },
    },
  };

  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  });
  if(windowWidth>=320 && windowWidth<=480){
    UpcomingStyle.display = "none"
  }

  return (
    <>
      <div className="Upcoming" style={UpcomingStyle}>
        <h2>{"Upcoming: "}</h2>
        <p>{"Woohoo, no work due soon! "}</p>
        <span style={UpcomingStyle.buttonStyle.buttonSpan}>
          <button
            style={UpcomingStyle.buttonStyle}
            onClick={() => alert("No upcoming assignments due!")}
          >
            {"View all"}
          </button>
        </span>
      </div>
    </>
  );
};

export default Upcoming;
