import React, { useState, useEffect } from "react";

const ClassChat = () => {
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const sendBtn = "/images/send-message-removebg-preview.png";
  const ClassChatStyle = {
    display: "flex",
    alignItems: "center",
    width: "70%",
    border: "1px solid black",
    borderRadius: "20px",
    padding: "1%",
    inputStyle: {
      width: "80%",
      padding: "4% 12% 4% 4%",
      fontSize: "18px",
      border: "none",
      outline: "none",
      fontFamily: "inherit",
    },
    imgStyle: {
      width: "25px",
      height: "25px",
      cursor: "pointer",
    },
  };
  if (windowWidth >= 320 && windowWidth <= 480) {
    ClassChatStyle.padding = "10% 15% ";
    ClassChatStyle.inputStyle.padding="8% 5%"
  }

  return (
    <div className="ClassChat" style={ClassChatStyle}>
      <input
        required
        type="text"
        placeholder="Announce something to the class..."
        style={ClassChatStyle.inputStyle}
      />
      <img src={sendBtn} alt="" style={ClassChatStyle.imgStyle} />
    </div>
  );
};

export default ClassChat;
