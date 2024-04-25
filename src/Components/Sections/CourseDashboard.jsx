import React, { Component } from "react";
import CourseHeadline from "./CourseHeadline";
import Upcoming from "./Upcoming";
import ClassChat from "./ClassChat";
import Navbar from "../Navbar/Navbar";


export class CourseDashboard extends Component {
  render() {
    const CourseDashboardStyles = {
      width: "80%",
      margin: "auto",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      spanStyle: {},
      contentContainerStyles: {
        marginTop: "3%",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        width: "100%",
      },
    };

    return (
      <>
        <Navbar />
        <div className="CourseDashboard" style={CourseDashboardStyles}>
          <CourseHeadline />
          <div style={CourseDashboardStyles.contentContainerStyles}>
            <Upcoming />
            <ClassChat />
          </div>
        </div>
      </>
    );
  }
}

export default CourseDashboard;
