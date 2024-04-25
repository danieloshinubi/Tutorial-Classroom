import React from "react";
import { Link } from "react-router-dom";
import { YearStyle } from "../YearStyle";

const FourHundredLvlCourses = () => {
  const lvlCourseList = [
    { course_id: "1", course: "GEDS400" },
    { course_id: "2", course: "COSC333" },
    { course_id: "3", course: "SENG400" },
    { course_id: "4", course: "COSC401" },
    { course_id: "5", course: "COSC427" },
    { course_id: "6", course: "COSC409" },
    { course_id: "7", course: "ITGY401" },
    { course_id: "8", course: "COSC423" },
    { course_id: "9", course: "COSC425" },  
    { course_id: "10", course: "GEDS420" },
    { course_id: "11", course: "COSC430" },
    { course_id: "12", course: "COSC408" },
    { course_id: "13", course: "SENG412" },
    { course_id: "14", course: "COSC424" },
    { course_id: "15", course: "COSC490" },
    { course_id: "16", course: "COSC402" },
  ];


  return (
    <div className="FourHundredLvlCourses">
      <h1 style={YearStyle.headStyle}>{"400 Level Courses:"}</h1>
      <div style={YearStyle}>
        {lvlCourseList.map((code, i) => {
          switch (code.course_id) {
            case "1":
              return (
                <Link
                  to={"/Levels/400/Courses/GEDS400"}
                  style={YearStyle.linkStyle}
                >
                  <div
                    key={code.course_id}
                    style={YearStyle.boxStyle}
                    className="level-box"
                  >
                    <h2>{code.course}</h2>
                  </div>
                </Link>
              );
            case "2":
              return (
                <Link
                  to={"/Levels/400/Courses/COSC333"}
                  style={YearStyle.linkStyle}
                >
                  <div
                    key={code.course_id}
                    style={YearStyle.boxStyle}
                    className="level-box"
                  >
                    <h2>{code.course}</h2>
                  </div>
                </Link>
              );
            case "3":
              return (
                <Link
                  to={"/Levels/400/Courses/SENG400"}
                  style={YearStyle.linkStyle}
                >
                  <div
                    key={code.course_id}
                    style={YearStyle.boxStyle}
                    className="level-box"
                  >
                    <h2>{code.course}</h2>
                  </div>
                </Link>
              );
            case "4":
              return (
                <Link
                  to={"/Levels/400/Courses/COSC401"}
                  style={YearStyle.linkStyle}
                >
                  <div
                    key={code.course_id}
                    style={YearStyle.boxStyle}
                    className="level-box"
                  >
                    <h2>{code.course}</h2>
                  </div>
                </Link>
              );
          }
        })}
      </div>
    </div>
  );
};

export default FourHundredLvlCourses;
