import React, { Component } from "react";

export class CourseHeadline extends Component {
  render() {
    const classroom = "/images/classroom.png";

    const DashStyles = {
      color: "white",
      textAlign: "center",
      backgroundImage: "url(/images/classroom.png)",
      backgroundSize: "cover",
      backgroundRepeat: "no-repeat",
      backgroundSize: "contain",
      position: "relative",
      borderRadius: "30px",
      display: "flex",
      height: "300px",
      justifyContent: "space-between",
      backgroundPosition: "right",
      backgroundColor: "gray",
      headOne: { fontWeight: "600" },
      headTwo: { fontWeight: "500" },
      headFour: { fontWeight: "400" },
      topDiv: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        position: "relative",
        width: "100%",
      },
      spanStyle: {
        display: "flex",
        flexDirection: "column",
        margin: "auto",
      },
    };
    return (
      <div className="CourseHeadline" style={DashStyles.topDiv}>
        <div style={DashStyles} className="setBg">
          <span style={DashStyles.spanStyle}>
            <h1 style={DashStyles.headOne}>{"STAT101"}</h1>
            <h3 style={DashStyles.headTwo}>
              {"Biblical Principles in Personal and Professional Life"}
            </h3>
            <h4 style={DashStyles.headFour}>{"300level"}</h4>
          </span>
        </div>
      </div>
    );
  }
}

export default CourseHeadline;
