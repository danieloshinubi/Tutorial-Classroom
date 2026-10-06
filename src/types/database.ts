export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  classroom: {
    Tables: {
      accounting_settings: {
        Row: {
          created_at: string
          created_by: string | null
          restock_paid_from: string
          school_id: string
          start_date: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          restock_paid_from?: string
          school_id: string
          start_date: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          restock_paid_from?: string
          school_id?: string
          start_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_settings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_settings_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: true
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      admission_config: {
        Row: {
          academic_hierarchy: string
          acceptance_fee_amount: number
          acceptance_fee_enabled: boolean
          allow_anonymous_apply: boolean
          application_fee_amount: number
          application_fee_enabled: boolean
          created_at: string
          currency: string
          form_locked_until_paid: boolean
          id: string
          payment_verification: string
          require_interview: boolean
          require_jamb: boolean
          require_matric: boolean
          require_next_of_kin: boolean
          require_referees: boolean
          school_id: string
          session_id: string | null
          updated_at: string
          use_applicant_accounts: boolean
        }
        Insert: {
          academic_hierarchy?: string
          acceptance_fee_amount?: number
          acceptance_fee_enabled?: boolean
          allow_anonymous_apply?: boolean
          application_fee_amount?: number
          application_fee_enabled?: boolean
          created_at?: string
          currency?: string
          form_locked_until_paid?: boolean
          id?: string
          payment_verification?: string
          require_interview?: boolean
          require_jamb?: boolean
          require_matric?: boolean
          require_next_of_kin?: boolean
          require_referees?: boolean
          school_id: string
          session_id?: string | null
          updated_at?: string
          use_applicant_accounts?: boolean
        }
        Update: {
          academic_hierarchy?: string
          acceptance_fee_amount?: number
          acceptance_fee_enabled?: boolean
          allow_anonymous_apply?: boolean
          application_fee_amount?: number
          application_fee_enabled?: boolean
          created_at?: string
          currency?: string
          form_locked_until_paid?: boolean
          id?: string
          payment_verification?: string
          require_interview?: boolean
          require_jamb?: boolean
          require_matric?: boolean
          require_next_of_kin?: boolean
          require_referees?: boolean
          school_id?: string
          session_id?: string | null
          updated_at?: string
          use_applicant_accounts?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "admission_config_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_config_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      admission_messages: {
        Row: {
          application_id: string
          created_at: string
          error: string | null
          id: string
          kind: string
          school_id: string
          sent_by: string | null
          sent_to: string
          status: string
          subject: string
        }
        Insert: {
          application_id: string
          created_at?: string
          error?: string | null
          id?: string
          kind: string
          school_id: string
          sent_by?: string | null
          sent_to: string
          status: string
          subject: string
        }
        Update: {
          application_id?: string
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          school_id?: string
          sent_by?: string | null
          sent_to?: string
          status?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "admission_messages_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_messages_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_messages_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admission_offers: {
        Row: {
          accepted_at: string | null
          application_id: string
          class_id: string | null
          conditions: string | null
          created_at: string
          decline_reason: string | null
          declined_at: string | null
          expires_at: string | null
          id: string
          issued_at: string
          issued_by: string | null
          letter_path: string | null
          programme_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          application_id: string
          class_id?: string | null
          conditions?: string | null
          created_at?: string
          decline_reason?: string | null
          declined_at?: string | null
          expires_at?: string | null
          id?: string
          issued_at?: string
          issued_by?: string | null
          letter_path?: string | null
          programme_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          application_id?: string
          class_id?: string | null
          conditions?: string | null
          created_at?: string
          decline_reason?: string | null
          declined_at?: string | null
          expires_at?: string | null
          id?: string
          issued_at?: string
          issued_by?: string | null
          letter_path?: string | null
          programme_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admission_offers_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_offers_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_offers_programme_id_fkey"
            columns: ["programme_id"]
            isOneToOne: false
            referencedRelation: "admission_programmes"
            referencedColumns: ["id"]
          },
        ]
      }
      admission_programmes: {
        Row: {
          capacity: number | null
          code: string
          created_at: string
          department: string | null
          entry_requirements: Json
          faculty: string | null
          id: string
          is_active: boolean
          name: string
          school_id: string
          session_id: string
          study_mode: string | null
          updated_at: string
        }
        Insert: {
          capacity?: number | null
          code: string
          created_at?: string
          department?: string | null
          entry_requirements?: Json
          faculty?: string | null
          id?: string
          is_active?: boolean
          name: string
          school_id: string
          session_id: string
          study_mode?: string | null
          updated_at?: string
        }
        Update: {
          capacity?: number | null
          code?: string
          created_at?: string
          department?: string | null
          entry_requirements?: Json
          faculty?: string | null
          id?: string
          is_active?: boolean
          name?: string
          school_id?: string
          session_id?: string
          study_mode?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admission_programmes_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_programmes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage: {
        Row: {
          created_at: string
          error: string | null
          id: string
          input_tokens: number
          model: string
          output_tokens: number
          school_id: string
          surface: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          input_tokens?: number
          model: string
          output_tokens?: number
          school_id: string
          surface?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          input_tokens?: number
          model?: string
          output_tokens?: number
          school_id?: string
          surface?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      applicant_accounts: {
        Row: {
          created_at: string
          date_of_birth: string | null
          email: string
          first_name: string
          id: string
          middle_name: string | null
          nationality: string | null
          phone: string | null
          school_id: string
          surname: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date_of_birth?: string | null
          email: string
          first_name: string
          id?: string
          middle_name?: string | null
          nationality?: string | null
          phone?: string | null
          school_id: string
          surname: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          date_of_birth?: string | null
          email?: string
          first_name?: string
          id?: string
          middle_name?: string | null
          nationality?: string | null
          phone?: string | null
          school_id?: string
          surname?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "applicant_accounts_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      applicant_documents: {
        Row: {
          application_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          document_id: string | null
          id: string
          requirement_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          application_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          document_id?: string | null
          id?: string
          requirement_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          application_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          document_id?: string | null
          id?: string
          requirement_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "applicant_documents_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applicant_documents_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "application_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applicant_documents_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "document_requirements"
            referencedColumns: ["id"]
          },
        ]
      }
      application_documents: {
        Row: {
          application_id: string
          file_name: string | null
          file_path: string
          file_size: number | null
          id: string
          kind: string
          mime_type: string | null
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          application_id: string
          file_name?: string | null
          file_path: string
          file_size?: number | null
          id?: string
          kind?: string
          mime_type?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          application_id?: string
          file_name?: string | null
          file_path?: string
          file_size?: number | null
          id?: string
          kind?: string
          mime_type?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "application_documents_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      application_events: {
        Row: {
          actor_id: string | null
          actor_label: string | null
          application_id: string
          created_at: string
          id: string
          note: string | null
          status_from:
            | Database["classroom"]["Enums"]["application_status"]
            | null
          status_to: Database["classroom"]["Enums"]["application_status"] | null
        }
        Insert: {
          actor_id?: string | null
          actor_label?: string | null
          application_id: string
          created_at?: string
          id?: string
          note?: string | null
          status_from?:
            | Database["classroom"]["Enums"]["application_status"]
            | null
          status_to?:
            | Database["classroom"]["Enums"]["application_status"]
            | null
        }
        Update: {
          actor_id?: string | null
          actor_label?: string | null
          application_id?: string
          created_at?: string
          id?: string
          note?: string | null
          status_from?:
            | Database["classroom"]["Enums"]["application_status"]
            | null
          status_to?:
            | Database["classroom"]["Enums"]["application_status"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "application_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      application_interviews: {
        Row: {
          application_id: string
          cancellation_reason: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          interviewer_id: string | null
          location: string | null
          meeting_link: string | null
          notes: string | null
          outcome: string | null
          scheduled_at: string
          scheduled_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          application_id: string
          cancellation_reason?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          interviewer_id?: string | null
          location?: string | null
          meeting_link?: string | null
          notes?: string | null
          outcome?: string | null
          scheduled_at: string
          scheduled_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          application_id?: string
          cancellation_reason?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          interviewer_id?: string | null
          location?: string | null
          meeting_link?: string | null
          notes?: string | null
          outcome?: string | null
          scheduled_at?: string
          scheduled_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_interviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      application_reviews: {
        Row: {
          academic_score: number | null
          application_id: string
          assigned_at: string
          assigned_by: string | null
          completed_at: string | null
          created_at: string
          id: string
          interview_score: number | null
          notes: string | null
          recommendation: string | null
          reviewer_id: string
          total_score: number | null
          updated_at: string
        }
        Insert: {
          academic_score?: number | null
          application_id: string
          assigned_at?: string
          assigned_by?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          interview_score?: number | null
          notes?: string | null
          recommendation?: string | null
          reviewer_id: string
          total_score?: number | null
          updated_at?: string
        }
        Update: {
          academic_score?: number | null
          application_id?: string
          assigned_at?: string
          assigned_by?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          interview_score?: number | null
          notes?: string | null
          recommendation?: string | null
          reviewer_id?: string
          total_score?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_reviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      application_screening_items: {
        Row: {
          application_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          is_required: boolean
          kind: string
          label: string
          position: number
          requirement_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          application_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          is_required?: boolean
          kind: string
          label: string
          position?: number
          requirement_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          application_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          is_required?: boolean
          kind?: string
          label?: string
          position?: number
          requirement_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_screening_items_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_screening_items_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "screening_requirements"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          address: string | null
          applicant_id: string | null
          applying_for_level: number | null
          assigned_reviewer_id: string | null
          class_id: string | null
          clearance_state: string
          correction_reason: string | null
          correction_requested_at: string | null
          correction_requested_by: string | null
          correction_resubmitted_at: string | null
          correction_sections: string[] | null
          created_at: string
          date_of_birth: string | null
          decided_at: string | null
          decided_by: string | null
          decision_state: string
          declaration_accepted_at: string | null
          document_links: string | null
          documents_state: string
          education_history: Json | null
          exam_results: Json | null
          final_decided_at: string | null
          final_decided_by: string | null
          final_decision_note: string | null
          first_name: string
          form_state: string
          gender: string | null
          guardian_email: string
          guardian_name: string
          guardian_phone: string | null
          guardian_relation: string | null
          id: string
          interview_state: string
          it_ticket_id: string | null
          middle_name: string | null
          next_of_kin: Json | null
          notes: string | null
          offer_expires_at: string | null
          offer_state: string
          payment_state: string
          personal_info: Json | null
          previous_school: string | null
          programme_id: string | null
          referees: Json | null
          reference: string
          registration_state: string
          review_completed_at: string | null
          review_state: string
          school_id: string
          screening_completed_at: string | null
          screening_state: string
          seq: number
          session_id: string | null
          status: Database["classroom"]["Enums"]["application_status"]
          student_account_id: string | null
          student_id: string | null
          submitted_at: string | null
          submitted_snapshot: Json | null
          surname: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          applicant_id?: string | null
          applying_for_level?: number | null
          assigned_reviewer_id?: string | null
          class_id?: string | null
          clearance_state?: string
          correction_reason?: string | null
          correction_requested_at?: string | null
          correction_requested_by?: string | null
          correction_resubmitted_at?: string | null
          correction_sections?: string[] | null
          created_at?: string
          date_of_birth?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_state?: string
          declaration_accepted_at?: string | null
          document_links?: string | null
          documents_state?: string
          education_history?: Json | null
          exam_results?: Json | null
          final_decided_at?: string | null
          final_decided_by?: string | null
          final_decision_note?: string | null
          first_name: string
          form_state?: string
          gender?: string | null
          guardian_email: string
          guardian_name: string
          guardian_phone?: string | null
          guardian_relation?: string | null
          id?: string
          interview_state?: string
          it_ticket_id?: string | null
          middle_name?: string | null
          next_of_kin?: Json | null
          notes?: string | null
          offer_expires_at?: string | null
          offer_state?: string
          payment_state?: string
          personal_info?: Json | null
          previous_school?: string | null
          programme_id?: string | null
          referees?: Json | null
          reference: string
          registration_state?: string
          review_completed_at?: string | null
          review_state?: string
          school_id: string
          screening_completed_at?: string | null
          screening_state?: string
          seq: number
          session_id?: string | null
          status?: Database["classroom"]["Enums"]["application_status"]
          student_account_id?: string | null
          student_id?: string | null
          submitted_at?: string | null
          submitted_snapshot?: Json | null
          surname: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          applicant_id?: string | null
          applying_for_level?: number | null
          assigned_reviewer_id?: string | null
          class_id?: string | null
          clearance_state?: string
          correction_reason?: string | null
          correction_requested_at?: string | null
          correction_requested_by?: string | null
          correction_resubmitted_at?: string | null
          correction_sections?: string[] | null
          created_at?: string
          date_of_birth?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_state?: string
          declaration_accepted_at?: string | null
          document_links?: string | null
          documents_state?: string
          education_history?: Json | null
          exam_results?: Json | null
          final_decided_at?: string | null
          final_decided_by?: string | null
          final_decision_note?: string | null
          first_name?: string
          form_state?: string
          gender?: string | null
          guardian_email?: string
          guardian_name?: string
          guardian_phone?: string | null
          guardian_relation?: string | null
          id?: string
          interview_state?: string
          it_ticket_id?: string | null
          middle_name?: string | null
          next_of_kin?: Json | null
          notes?: string | null
          offer_expires_at?: string | null
          offer_state?: string
          payment_state?: string
          personal_info?: Json | null
          previous_school?: string | null
          programme_id?: string | null
          referees?: Json | null
          reference?: string
          registration_state?: string
          review_completed_at?: string | null
          review_state?: string
          school_id?: string
          screening_completed_at?: string | null
          screening_state?: string
          seq?: number
          session_id?: string | null
          status?: Database["classroom"]["Enums"]["application_status"]
          student_account_id?: string | null
          student_id?: string | null
          submitted_at?: string | null
          submitted_snapshot?: Json | null
          surname?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_applicant_id_fkey"
            columns: ["applicant_id"]
            isOneToOne: false
            referencedRelation: "applicant_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_it_ticket_id_fkey"
            columns: ["it_ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_programme_id_fkey"
            columns: ["programme_id"]
            isOneToOne: false
            referencedRelation: "admission_programmes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments: {
        Row: {
          course_id: string
          created_at: string
          created_by: string | null
          description: string | null
          due_at: string | null
          file_name: string | null
          file_path: string | null
          file_size: number | null
          id: string
          link_url: string | null
          mime_type: string | null
          points: number
          title: string
        }
        Insert: {
          course_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          link_url?: string | null
          mime_type?: string | null
          points?: number
          title: string
        }
        Update: {
          course_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          link_url?: string | null
          mime_type?: string | null
          points?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "result_slips"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_devices: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          key_hash: string
          label: string
          last_used_at: string | null
          school_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          key_hash: string
          label?: string
          last_used_at?: string | null
          school_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          key_hash?: string
          label?: string
          last_used_at?: string | null
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_devices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_devices_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_enrolments: {
        Row: {
          created_at: string
          created_by: string | null
          device_id: string | null
          external_id: string
          id: string
          note: string | null
          person_id: string
          school_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          device_id?: string | null
          external_id: string
          id?: string
          note?: string | null
          person_id: string
          school_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          device_id?: string | null
          external_id?: string
          id?: string
          note?: string | null
          person_id?: string
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_enrolments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_enrolments_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "attendance_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_enrolments_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_enrolments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          class_id: string
          created_at: string
          id: string
          marked_by: string | null
          note: string | null
          school_id: string
          session_at: string
          status: string
          student_id: string
          term_id: string | null
          updated_at: string
        }
        Insert: {
          class_id: string
          created_at?: string
          id?: string
          marked_by?: string | null
          note?: string | null
          school_id: string
          session_at: string
          status: string
          student_id: string
          term_id?: string | null
          updated_at?: string
        }
        Update: {
          class_id?: string
          created_at?: string
          id?: string
          marked_by?: string | null
          note?: string | null
          school_id?: string
          session_at?: string
          status?: string
          student_id?: string
          term_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_marked_by_fkey"
            columns: ["marked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "result_slips"
            referencedColumns: ["term_id"]
          },
          {
            foreignKeyName: "attendance_records_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_label: string | null
          actor_role: string | null
          changed_fields: string[] | null
          country: string | null
          created_at: string
          id: string
          ip_address: string | null
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          school_id: string | null
          table_name: string
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_label?: string | null
          actor_role?: string | null
          changed_fields?: string[] | null
          country?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          school_id?: string | null
          table_name: string
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_label?: string | null
          actor_role?: string | null
          changed_fields?: string[] | null
          country?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          school_id?: string | null
          table_name?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_records: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          note: string | null
          period_end: string
          period_start: string
          plan: string
          recorded_by: string | null
          school_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: string
          note?: string | null
          period_end: string
          period_start: string
          plan: string
          recorded_by?: string | null
          school_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          note?: string | null
          period_end?: string
          period_start?: string
          plan?: string
          recorded_by?: string | null
          school_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_records_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_records_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      chart_of_accounts: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          position: number
          school_id: string
          system_key: string | null
          type: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          position?: number
          school_id: string
          system_key?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          position?: number
          school_id?: string
          system_key?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chart_of_accounts_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_channel_members: {
        Row: {
          channel_id: string
          is_muted: boolean
          joined_at: string
          last_read_at: string
          role: string
          user_id: string
        }
        Insert: {
          channel_id: string
          is_muted?: boolean
          joined_at?: string
          last_read_at?: string
          role?: string
          user_id: string
        }
        Update: {
          channel_id?: string
          is_muted?: boolean
          joined_at?: string
          last_read_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_channel_members_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_channels: {
        Row: {
          created_at: string
          created_by: string | null
          dm_key: string | null
          id: string
          is_private: boolean
          kind: string
          last_message_at: string
          name: string | null
          school_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dm_key?: string | null
          id?: string
          is_private?: boolean
          kind: string
          last_message_at?: string
          name?: string | null
          school_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dm_key?: string | null
          id?: string
          is_private?: boolean
          kind?: string
          last_message_at?: string
          name?: string | null
          school_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_channels_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_message_reactions: {
        Row: {
          created_at: string
          emoji: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_message_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          attachment_mime: string | null
          attachment_name: string | null
          attachment_path: string | null
          attachment_size: number | null
          author_id: string | null
          body: string
          channel_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          reply_to_id: string | null
        }
        Insert: {
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_size?: number | null
          author_id?: string | null
          body: string
          channel_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          reply_to_id?: string | null
        }
        Update: {
          attachment_mime?: string | null
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_size?: number | null
          author_id?: string | null
          body?: string
          channel_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          reply_to_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      class_students: {
        Row: {
          added_at: string
          class_id: string
          id: string
          student_id: string
        }
        Insert: {
          added_at?: string
          class_id: string
          id?: string
          student_id: string
        }
        Update: {
          added_at?: string
          class_id?: string
          id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_students_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_students_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      class_subjects: {
        Row: {
          class_id: string
          created_at: string
          id: string
          school_id: string
          subject_id: string
          teacher_id: string | null
        }
        Insert: {
          class_id: string
          created_at?: string
          id?: string
          school_id: string
          subject_id: string
          teacher_id?: string | null
        }
        Update: {
          class_id?: string
          created_at?: string
          id?: string
          school_id?: string
          subject_id?: string
          teacher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "class_subjects_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_subjects_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_subjects_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_subjects_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          created_at: string
          form_teacher_id: string | null
          id: string
          level_year: number
          name: string
          school_id: string
          session_id: string | null
        }
        Insert: {
          created_at?: string
          form_teacher_id?: string | null
          id?: string
          level_year: number
          name: string
          school_id: string
          session_id?: string | null
        }
        Update: {
          created_at?: string
          form_teacher_id?: string | null
          id?: string
          level_year?: number
          name?: string
          school_id?: string
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "classes_form_teacher_id_fkey"
            columns: ["form_teacher_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classes_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classes_school_id_level_year_fkey"
            columns: ["school_id", "level_year"]
            isOneToOne: false
            referencedRelation: "levels"
            referencedColumns: ["school_id", "year"]
          },
          {
            foreignKeyName: "classes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      clearance_checklists: {
        Row: {
          application_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          department_id: string
          id: string
          status: string
          updated_at: string
        }
        Insert: {
          application_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          department_id: string
          id?: string
          status?: string
          updated_at?: string
        }
        Update: {
          application_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          department_id?: string
          id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clearance_checklists_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clearance_checklists_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "clearance_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      clearance_departments: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          position: number
          school_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          position?: number
          school_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          position?: number
          school_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clearance_departments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          archived: boolean
          class_subject_id: string | null
          code: string
          created_at: string
          description: string | null
          id: string
          join_policy: Database["classroom"]["Enums"]["join_policy"]
          level_year: number | null
          owner_id: string | null
          school_id: string
          session_id: string | null
          title: string
        }
        Insert: {
          archived?: boolean
          class_subject_id?: string | null
          code: string
          created_at?: string
          description?: string | null
          id?: string
          join_policy?: Database["classroom"]["Enums"]["join_policy"]
          level_year?: number | null
          owner_id?: string | null
          school_id: string
          session_id?: string | null
          title?: string
        }
        Update: {
          archived?: boolean
          class_subject_id?: string | null
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          join_policy?: Database["classroom"]["Enums"]["join_policy"]
          level_year?: number | null
          owner_id?: string | null
          school_id?: string
          session_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_class_subject_id_fkey"
            columns: ["class_subject_id"]
            isOneToOne: false
            referencedRelation: "class_subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courses_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courses_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courses_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      discount_rule_items: {
        Row: {
          catalogue_id: string
          kind: string
          rule_id: string
          value: number
        }
        Insert: {
          catalogue_id: string
          kind: string
          rule_id: string
          value: number
        }
        Update: {
          catalogue_id?: string
          kind?: string
          rule_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "discount_rule_items_catalogue_id_fkey"
            columns: ["catalogue_id"]
            isOneToOne: false
            referencedRelation: "fee_catalogue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_rule_items_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "discount_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      discount_rules: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          kind: string
          label: string
          position: number
          school_id: string
          value: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          kind: string
          label: string
          position?: number
          school_id: string
          value: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          label?: string
          position?: number
          school_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "discount_rules_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      document_requirements: {
        Row: {
          applicant_category: string | null
          created_at: string
          id: string
          is_required: boolean
          kind: string
          label: string
          notes: string | null
          position: number
          programme_id: string | null
          school_id: string
          session_id: string | null
          updated_at: string
        }
        Insert: {
          applicant_category?: string | null
          created_at?: string
          id?: string
          is_required?: boolean
          kind: string
          label: string
          notes?: string | null
          position?: number
          programme_id?: string | null
          school_id: string
          session_id?: string | null
          updated_at?: string
        }
        Update: {
          applicant_category?: string | null
          created_at?: string
          id?: string
          is_required?: boolean
          kind?: string
          label?: string
          notes?: string | null
          position?: number
          programme_id?: string | null
          school_id?: string
          session_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_requirements_programme_id_fkey"
            columns: ["programme_id"]
            isOneToOne: false
            referencedRelation: "admission_programmes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requirements_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_requirements_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollments: {
        Row: {
          course_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          message: string | null
          requested_at: string
          status: Database["classroom"]["Enums"]["enrollment_status"]
          user_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          message?: string | null
          requested_at?: string
          status?: Database["classroom"]["Enums"]["enrollment_status"]
          user_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          message?: string | null
          requested_at?: string
          status?: Database["classroom"]["Enums"]["enrollment_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "result_slips"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "enrollments_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_answers: {
        Row: {
          answer_text: string | null
          attempt_id: string
          awarded_points: number | null
          id: string
          question_id: string
          selected_option_id: string | null
        }
        Insert: {
          answer_text?: string | null
          attempt_id: string
          awarded_points?: number | null
          id?: string
          question_id: string
          selected_option_id?: string | null
        }
        Update: {
          answer_text?: string | null
          attempt_id?: string
          awarded_points?: number | null
          id?: string
          question_id?: string
          selected_option_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exam_answers_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "exam_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "exam_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_answers_selected_option_id_fkey"
            columns: ["selected_option_id"]
            isOneToOne: false
            referencedRelation: "exam_options"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_attempts: {
        Row: {
          auto_score: number | null
          auto_submitted: boolean
          disqualified: boolean
          disqualified_reason: string | null
          exam_id: string
          graded_at: string | null
          id: string
          max_score: number | null
          started_at: string
          submitted_at: string | null
          submitted_late: boolean
          total_score: number | null
          user_id: string
          violations: number
        }
        Insert: {
          auto_score?: number | null
          auto_submitted?: boolean
          disqualified?: boolean
          disqualified_reason?: string | null
          exam_id: string
          graded_at?: string | null
          id?: string
          max_score?: number | null
          started_at?: string
          submitted_at?: string | null
          submitted_late?: boolean
          total_score?: number | null
          user_id: string
          violations?: number
        }
        Update: {
          auto_score?: number | null
          auto_submitted?: boolean
          disqualified?: boolean
          disqualified_reason?: string | null
          exam_id?: string
          graded_at?: string | null
          id?: string
          max_score?: number | null
          started_at?: string
          submitted_at?: string | null
          submitted_late?: boolean
          total_score?: number | null
          user_id?: string
          violations?: number
        }
        Relationships: [
          {
            foreignKeyName: "exam_attempts_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_events: {
        Row: {
          attempt_id: string
          created_at: string
          detail: string | null
          id: string
          kind: string
        }
        Insert: {
          attempt_id: string
          created_at?: string
          detail?: string | null
          id?: string
          kind: string
        }
        Update: {
          attempt_id?: string
          created_at?: string
          detail?: string | null
          id?: string
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_events_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "exam_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_options: {
        Row: {
          body: string
          id: string
          is_correct: boolean
          position: number
          question_id: string
        }
        Insert: {
          body: string
          id?: string
          is_correct?: boolean
          position?: number
          question_id: string
        }
        Update: {
          body?: string
          id?: string
          is_correct?: boolean
          position?: number
          question_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_options_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "exam_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_questions: {
        Row: {
          answer_key: string | null
          exam_id: string
          id: string
          image_path: string | null
          kind: Database["classroom"]["Enums"]["question_kind"]
          points: number
          position: number
          prompt: string
        }
        Insert: {
          answer_key?: string | null
          exam_id: string
          id?: string
          image_path?: string | null
          kind?: Database["classroom"]["Enums"]["question_kind"]
          points?: number
          position?: number
          prompt: string
        }
        Update: {
          answer_key?: string | null
          exam_id?: string
          id?: string
          image_path?: string | null
          kind?: Database["classroom"]["Enums"]["question_kind"]
          points?: number
          position?: number
          prompt?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_questions_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
        ]
      }
      exams: {
        Row: {
          allow_calculator: boolean
          block_copy_paste: boolean
          closes_at: string | null
          course_id: string
          created_at: string
          created_by: string | null
          duration_mins: number | null
          grace_seconds: number
          id: string
          instructions: string | null
          kind: string
          max_violations: number
          opens_at: string | null
          published: boolean
          require_fullscreen: boolean
          show_results: boolean
          shuffle_options: boolean
          shuffle_questions: boolean
          title: string
        }
        Insert: {
          allow_calculator?: boolean
          block_copy_paste?: boolean
          closes_at?: string | null
          course_id: string
          created_at?: string
          created_by?: string | null
          duration_mins?: number | null
          grace_seconds?: number
          id?: string
          instructions?: string | null
          kind?: string
          max_violations?: number
          opens_at?: string | null
          published?: boolean
          require_fullscreen?: boolean
          show_results?: boolean
          shuffle_options?: boolean
          shuffle_questions?: boolean
          title: string
        }
        Update: {
          allow_calculator?: boolean
          block_copy_paste?: boolean
          closes_at?: string | null
          course_id?: string
          created_at?: string
          created_by?: string | null
          duration_mins?: number | null
          grace_seconds?: number
          id?: string
          instructions?: string | null
          kind?: string
          max_violations?: number
          opens_at?: string | null
          published?: boolean
          require_fullscreen?: boolean
          show_results?: boolean
          shuffle_options?: boolean
          shuffle_questions?: boolean
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "exams_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "result_slips"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "exams_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_catalogue: {
        Row: {
          category: string | null
          created_at: string
          default_amount: number | null
          id: string
          is_active: boolean
          label: string
          position: number
          school_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          default_amount?: number | null
          id?: string
          is_active?: boolean
          label: string
          position?: number
          school_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          default_amount?: number | null
          id?: string
          is_active?: boolean
          label?: string
          position?: number
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_catalogue_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_items: {
        Row: {
          amount: number
          catalogue_id: string | null
          created_at: string
          id: string
          is_optional: boolean
          name: string
          position: number
          structure_id: string
        }
        Insert: {
          amount: number
          catalogue_id?: string | null
          created_at?: string
          id?: string
          is_optional?: boolean
          name: string
          position?: number
          structure_id: string
        }
        Update: {
          amount?: number
          catalogue_id?: string | null
          created_at?: string
          id?: string
          is_optional?: boolean
          name?: string
          position?: number
          structure_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_items_catalogue_id_fkey"
            columns: ["catalogue_id"]
            isOneToOne: false
            referencedRelation: "fee_catalogue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_items_structure_id_fkey"
            columns: ["structure_id"]
            isOneToOne: false
            referencedRelation: "fee_structures"
            referencedColumns: ["id"]
          },
        ]
      }
      fee_structures: {
        Row: {
          class_id: string | null
          created_at: string
          created_by: string | null
          due_on: string | null
          id: string
          is_active: boolean
          level_year: number | null
          name: string
          notes: string | null
          purpose: string
          school_id: string
          session_id: string
          term_id: string
          updated_at: string
        }
        Insert: {
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          due_on?: string | null
          id?: string
          is_active?: boolean
          level_year?: number | null
          name: string
          notes?: string | null
          purpose?: string
          school_id: string
          session_id: string
          term_id: string
          updated_at?: string
        }
        Update: {
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          due_on?: string | null
          id?: string
          is_active?: boolean
          level_year?: number | null
          name?: string
          notes?: string | null
          purpose?: string
          school_id?: string
          session_id?: string
          term_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fee_structures_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_structures_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_structures_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_structures_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fee_structures_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "result_slips"
            referencedColumns: ["term_id"]
          },
          {
            foreignKeyName: "fee_structures_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_students: {
        Row: {
          created_at: string
          guardian_id: string
          id: string
          is_primary: boolean
          relationship: string | null
          school_id: string
          student_id: string
        }
        Insert: {
          created_at?: string
          guardian_id: string
          id?: string
          is_primary?: boolean
          relationship?: string | null
          school_id: string
          student_id: string
        }
        Update: {
          created_at?: string
          guardian_id?: string
          id?: string
          is_primary?: boolean
          relationship?: string | null
          school_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardian_students_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_students_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_students_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          amount: number
          brought_forward_from: string | null
          catalogue_id: string | null
          id: string
          invoice_id: string
          name: string
          position: number
        }
        Insert: {
          amount: number
          brought_forward_from?: string | null
          catalogue_id?: string | null
          id?: string
          invoice_id: string
          name: string
          position?: number
        }
        Update: {
          amount?: number
          brought_forward_from?: string | null
          catalogue_id?: string | null
          id?: string
          invoice_id?: string
          name?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_brought_forward_from_fkey"
            columns: ["brought_forward_from"]
            isOneToOne: false
            referencedRelation: "invoice_balances"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_items_brought_forward_from_fkey"
            columns: ["brought_forward_from"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_brought_forward_from_fkey"
            columns: ["brought_forward_from"]
            isOneToOne: false
            referencedRelation: "my_invoice_balances"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_items_catalogue_id_fkey"
            columns: ["catalogue_id"]
            isOneToOne: false
            referencedRelation: "fee_catalogue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_balances"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "my_invoice_balances"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      invoices: {
        Row: {
          application_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          class_id: string | null
          created_at: string
          created_by: string | null
          discount: number
          discount_reason: string | null
          discount_rule_id: string | null
          due_on: string | null
          id: string
          issued_at: string | null
          issued_by: string | null
          notes: string | null
          purpose: string
          reference: string
          school_id: string
          seq: number
          session_id: string
          status: Database["classroom"]["Enums"]["invoice_status"]
          structure_id: string | null
          student_id: string | null
          term_id: string | null
          updated_at: string
        }
        Insert: {
          application_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          discount?: number
          discount_reason?: string | null
          discount_rule_id?: string | null
          due_on?: string | null
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          notes?: string | null
          purpose?: string
          reference: string
          school_id: string
          seq: number
          session_id: string
          status?: Database["classroom"]["Enums"]["invoice_status"]
          structure_id?: string | null
          student_id?: string | null
          term_id?: string | null
          updated_at?: string
        }
        Update: {
          application_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          class_id?: string | null
          created_at?: string
          created_by?: string | null
          discount?: number
          discount_reason?: string | null
          discount_rule_id?: string | null
          due_on?: string | null
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          notes?: string | null
          purpose?: string
          reference?: string
          school_id?: string
          seq?: number
          session_id?: string
          status?: Database["classroom"]["Enums"]["invoice_status"]
          structure_id?: string | null
          student_id?: string | null
          term_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_discount_rule_id_fkey"
            columns: ["discount_rule_id"]
            isOneToOne: false
            referencedRelation: "discount_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_structure_id_fkey"
            columns: ["structure_id"]
            isOneToOne: false
            referencedRelation: "fee_structures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "result_slips"
            referencedColumns: ["term_id"]
          },
          {
            foreignKeyName: "invoices_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          created_at: string
          created_by: string | null
          entry_date: string
          id: string
          memo: string
          reversed_by: string | null
          reverses: string | null
          school_id: string
          source_event: string | null
          source_id: string | null
          source_type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          entry_date: string
          id?: string
          memo: string
          reversed_by?: string | null
          reverses?: string | null
          school_id: string
          source_event?: string | null
          source_id?: string | null
          source_type: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          entry_date?: string
          id?: string
          memo?: string
          reversed_by?: string | null
          reverses?: string | null
          school_id?: string
          source_event?: string | null
          source_id?: string | null
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_reverses_fkey"
            columns: ["reverses"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_lines: {
        Row: {
          account_id: string
          credit: number
          debit: number
          entry_id: string
          id: string
          memo: string | null
          position: number
          school_id: string
        }
        Insert: {
          account_id: string
          credit?: number
          debit?: number
          entry_id: string
          id?: string
          memo?: string | null
          position?: number
          school_id: string
        }
        Update: {
          account_id?: string
          credit?: number
          debit?: number
          entry_id?: string
          id?: string
          memo?: string | null
          position?: number
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      levels: {
        Row: {
          label: string
          school_id: string
          year: number
        }
        Insert: {
          label: string
          school_id: string
          year: number
        }
        Update: {
          label?: string
          school_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "levels_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_attachments: {
        Row: {
          content_id: string | null
          created_at: string
          envelope_id: string
          file_name: string
          file_path: string
          id: string
          mailbox_id: string
          mime_type: string
          size_bytes: number
        }
        Insert: {
          content_id?: string | null
          created_at?: string
          envelope_id: string
          file_name: string
          file_path: string
          id?: string
          mailbox_id: string
          mime_type?: string
          size_bytes?: number
        }
        Update: {
          content_id?: string | null
          created_at?: string
          envelope_id?: string
          file_name?: string
          file_path?: string
          id?: string
          mailbox_id?: string
          mime_type?: string
          size_bytes?: number
        }
        Relationships: [
          {
            foreignKeyName: "mail_attachments_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "mail_mailboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_autoreply_log: {
        Row: {
          mailbox_id: string
          sender: string
          sent_at: string
        }
        Insert: {
          mailbox_id: string
          sender: string
          sent_at?: string
        }
        Update: {
          mailbox_id?: string
          sender?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_autoreply_log_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "mail_mailboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_contact_groups: {
        Row: {
          created_at: string
          id: string
          mailbox_id: string
          members: Json
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          mailbox_id: string
          members?: Json
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          mailbox_id?: string
          members?: Json
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_contact_groups_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "mail_mailboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_contacts: {
        Row: {
          address: string
          company: string
          created_at: string
          id: string
          mailbox_id: string
          name: string
          notes: string
          phone: string
          updated_at: string
        }
        Insert: {
          address: string
          company?: string
          created_at?: string
          id?: string
          mailbox_id: string
          name?: string
          notes?: string
          phone?: string
          updated_at?: string
        }
        Update: {
          address?: string
          company?: string
          created_at?: string
          id?: string
          mailbox_id?: string
          name?: string
          notes?: string
          phone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_contacts_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "mail_mailboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_imports: {
        Row: {
          bytes: number
          created_at: string
          created_by: string | null
          cursor: Json
          failed: number
          file_paths: string[]
          finished_at: string | null
          found: number
          id: string
          imap_host: string | null
          imap_port: number | null
          imap_security: string | null
          imap_username: string | null
          imported: number
          label: string
          last_error: string | null
          lease_until: string | null
          mailbox_id: string
          school_id: string
          secret_vault_id: string | null
          since: string | null
          skipped: number
          source: string
          source_user: string | null
          started_at: string | null
          status: string
          target_folder: string | null
          updated_at: string
        }
        Insert: {
          bytes?: number
          created_at?: string
          created_by?: string | null
          cursor?: Json
          failed?: number
          file_paths?: string[]
          finished_at?: string | null
          found?: number
          id?: string
          imap_host?: string | null
          imap_port?: number | null
          imap_security?: string | null
          imap_username?: string | null
          imported?: number
          label?: string
          last_error?: string | null
          lease_until?: string | null
          mailbox_id: string
          school_id: string
          secret_vault_id?: string | null
          since?: string | null
          skipped?: number
          source: string
          source_user?: string | null
          started_at?: string | null
          status?: string
          target_folder?: string | null
          updated_at?: string
        }
        Update: {
          bytes?: number
          created_at?: string
          created_by?: string | null
          cursor?: Json
          failed?: number
          file_paths?: string[]
          finished_at?: string | null
          found?: number
          id?: string
          imap_host?: string | null
          imap_port?: number | null
          imap_security?: string | null
          imap_username?: string | null
          imported?: number
          label?: string
          last_error?: string | null
          lease_until?: string | null
          mailbox_id?: string
          school_id?: string
          secret_vault_id?: string | null
          since?: string | null
          skipped?: number
          source?: string
          source_user?: string | null
          started_at?: string | null
          status?: string
          target_folder?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_imports_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "mail_mailboxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_imports_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_inbound_retry: {
        Row: {
          attempts: number
          created_at: string
          email_id: string
          last_error: string | null
          next_at: string
          school_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          email_id: string
          last_error?: string | null
          next_at?: string
          school_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          email_id?: string
          last_error?: string | null
          next_at?: string
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_inbound_retry_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_list_members: {
        Row: {
          list_id: string
          mailbox_id: string
        }
        Insert: {
          list_id: string
          mailbox_id: string
        }
        Update: {
          list_id?: string
          mailbox_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_list_members_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "mail_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_list_members_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "mail_mailboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_lists: {
        Row: {
          address: string
          allow_outside: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          school_id: string
          updated_at: string
        }
        Insert: {
          address: string
          allow_outside?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          school_id: string
          updated_at?: string
        }
        Update: {
          address?: string
          allow_outside?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          school_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_lists_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_mailbox_members: {
        Row: {
          access: string
          added_by: string | null
          created_at: string
          mailbox_id: string
          user_id: string
        }
        Insert: {
          access?: string
          added_by?: string | null
          created_at?: string
          mailbox_id: string
          user_id: string
        }
        Update: {
          access?: string
          added_by?: string | null
          created_at?: string
          mailbox_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_mailbox_members_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "mail_mailboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_mailboxes: {
        Row: {
          address: string
          autoreply_enabled: boolean
          autoreply_end: string | null
          autoreply_html: string
          autoreply_outside: boolean
          autoreply_start: string | null
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          kind: string
          notify_opens: boolean
          previous_addresses: string[]
          push_new_mail: boolean
          quota_bytes: number
          school_id: string
          signature_html: string
          undo_seconds: number
          updated_at: string
          used_bytes: number
          user_id: string | null
        }
        Insert: {
          address: string
          autoreply_enabled?: boolean
          autoreply_end?: string | null
          autoreply_html?: string
          autoreply_outside?: boolean
          autoreply_start?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          kind?: string
          notify_opens?: boolean
          previous_addresses?: string[]
          push_new_mail?: boolean
          quota_bytes?: number
          school_id: string
          signature_html?: string
          undo_seconds?: number
          updated_at?: string
          used_bytes?: number
          user_id?: string | null
        }
        Update: {
          address?: string
          autoreply_enabled?: boolean
          autoreply_end?: string | null
          autoreply_html?: string
          autoreply_outside?: boolean
          autoreply_start?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          kind?: string
          notify_opens?: boolean
          previous_addresses?: string[]
          push_new_mail?: boolean
          quota_bytes?: number
          school_id?: string
          signature_html?: string
          undo_seconds?: number
          updated_at?: string
          used_bytes?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mail_mailboxes_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_messages: {
        Row: {
          bcc_list: Json
          body_html: string
          cc_list: Json
          created_at: string
          envelope_id: string
          external_pending: number
          folder: string
          from_address: string
          from_name: string
          has_attachments: boolean
          id: string
          importance: string
          in_reply_to: string | null
          inbound_id: string | null
          is_auto: boolean
          is_flagged: boolean
          is_pinned: boolean
          is_read: boolean
          mailbox_id: string
          message_id: string
          previous_folder: string | null
          read_receipt: boolean
          recalled_at: string | null
          reply_to: Json
          scheduled_at: string | null
          scheduled_by: string | null
          sent_at: string | null
          size_bytes: number
          snippet: string
          spam_reasons: string[]
          spam_score: number | null
          subject: string
          thread_id: string
          to_list: Json
          track_opens: boolean
          updated_at: string
          warning: string | null
        }
        Insert: {
          bcc_list?: Json
          body_html?: string
          cc_list?: Json
          created_at?: string
          envelope_id?: string
          external_pending?: number
          folder?: string
          from_address?: string
          from_name?: string
          has_attachments?: boolean
          id?: string
          importance?: string
          in_reply_to?: string | null
          inbound_id?: string | null
          is_auto?: boolean
          is_flagged?: boolean
          is_pinned?: boolean
          is_read?: boolean
          mailbox_id: string
          message_id?: string
          previous_folder?: string | null
          read_receipt?: boolean
          recalled_at?: string | null
          reply_to?: Json
          scheduled_at?: string | null
          scheduled_by?: string | null
          sent_at?: string | null
          size_bytes?: number
          snippet?: string
          spam_reasons?: string[]
          spam_score?: number | null
          subject?: string
          thread_id?: string
          to_list?: Json
          track_opens?: boolean
          updated_at?: string
          warning?: string | null
        }
        Update: {
          bcc_list?: Json
          body_html?: string
          cc_list?: Json
          created_at?: string
          envelope_id?: string
          external_pending?: number
          folder?: string
          from_address?: string
          from_name?: string
          has_attachments?: boolean
          id?: string
          importance?: string
          in_reply_to?: string | null
          inbound_id?: string | null
          is_auto?: boolean
          is_flagged?: boolean
          is_pinned?: boolean
          is_read?: boolean
          mailbox_id?: string
          message_id?: string
          previous_folder?: string | null
          read_receipt?: boolean
          recalled_at?: string | null
          reply_to?: Json
          scheduled_at?: string | null
          scheduled_by?: string | null
          sent_at?: string | null
          size_bytes?: number
          snippet?: string
          spam_reasons?: string[]
          spam_score?: number | null
          subject?: string
          thread_id?: string
          to_list?: Json
          track_opens?: boolean
          updated_at?: string
          warning?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mail_messages_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "mail_mailboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_opens: {
        Row: {
          first_at: string
          id: string
          last_at: string
          message_id: string
          recipient: string
          times: number
          via: string
        }
        Insert: {
          first_at?: string
          id?: string
          last_at?: string
          message_id: string
          recipient: string
          times?: number
          via: string
        }
        Update: {
          first_at?: string
          id?: string
          last_at?: string
          message_id?: string
          recipient?: string
          times?: number
          via?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_opens_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "mail_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_outbound: {
        Row: {
          attempts: number
          created_at: string
          detail: string | null
          id: string
          kind: string
          last_error: string | null
          message_id: string
          next_attempt_at: string
          open_token: string | null
          provider_id: string | null
          recipient: string
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          detail?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          message_id: string
          next_attempt_at?: string
          open_token?: string | null
          provider_id?: string | null
          recipient: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          detail?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          message_id?: string
          next_attempt_at?: string
          open_token?: string | null
          provider_id?: string | null
          recipient?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_outbound_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "mail_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_reports: {
        Row: {
          copies_moved: number
          created_at: string
          id: string
          mailbox_id: string | null
          reported_by: string | null
          school_id: string
          sender: string
          subject: string
        }
        Insert: {
          copies_moved?: number
          created_at?: string
          id?: string
          mailbox_id?: string | null
          reported_by?: string | null
          school_id: string
          sender: string
          subject?: string
        }
        Update: {
          copies_moved?: number
          created_at?: string
          id?: string
          mailbox_id?: string | null
          reported_by?: string | null
          school_id?: string
          sender?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_reports_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "mail_mailboxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_reports_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_rules: {
        Row: {
          created_at: string
          enabled: boolean
          flag: boolean
          forward_to: string | null
          from_contains: string
          id: string
          mailbox_id: string
          mark_read: boolean
          move_to: string | null
          name: string
          position: number
          stop: boolean
          subject_contains: string
          updated_at: string
          with_attachments: boolean
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          flag?: boolean
          forward_to?: string | null
          from_contains?: string
          id?: string
          mailbox_id: string
          mark_read?: boolean
          move_to?: string | null
          name?: string
          position?: number
          stop?: boolean
          subject_contains?: string
          updated_at?: string
          with_attachments?: boolean
        }
        Update: {
          created_at?: string
          enabled?: boolean
          flag?: boolean
          forward_to?: string | null
          from_contains?: string
          id?: string
          mailbox_id?: string
          mark_read?: boolean
          move_to?: string | null
          name?: string
          position?: number
          stop?: boolean
          subject_contains?: string
          updated_at?: string
          with_attachments?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "mail_rules_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "mail_mailboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_sender_lists: {
        Row: {
          created_at: string
          kind: string
          mailbox_id: string
          value: string
        }
        Insert: {
          created_at?: string
          kind: string
          mailbox_id: string
          value: string
        }
        Update: {
          created_at?: string
          kind?: string
          mailbox_id?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_sender_lists_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "mail_mailboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_settings: {
        Row: {
          blocked_senders: string[]
          checked_at: string | null
          connected_at: string | null
          connected_by: string | null
          deleted_days: number
          dns_records: Json
          domain: string | null
          domain_status: string
          junk_days: number
          key_hint: string | null
          key_vault_id: string | null
          last_error: string | null
          max_outside_day: number
          max_outside_hour: number
          microsoft_consent_at: string | null
          microsoft_tenant: string | null
          platform_dns_at: string | null
          receiving_enabled: boolean
          receiving_status: string
          region: string
          resend_domain_id: string | null
          school_id: string
          sending_enabled: boolean
          updated_at: string
          webhook_id: string | null
          webhook_vault_id: string | null
        }
        Insert: {
          blocked_senders?: string[]
          checked_at?: string | null
          connected_at?: string | null
          connected_by?: string | null
          deleted_days?: number
          dns_records?: Json
          domain?: string | null
          domain_status?: string
          junk_days?: number
          key_hint?: string | null
          key_vault_id?: string | null
          last_error?: string | null
          max_outside_day?: number
          max_outside_hour?: number
          microsoft_consent_at?: string | null
          microsoft_tenant?: string | null
          platform_dns_at?: string | null
          receiving_enabled?: boolean
          receiving_status?: string
          region?: string
          resend_domain_id?: string | null
          school_id: string
          sending_enabled?: boolean
          updated_at?: string
          webhook_id?: string | null
          webhook_vault_id?: string | null
        }
        Update: {
          blocked_senders?: string[]
          checked_at?: string | null
          connected_at?: string | null
          connected_by?: string | null
          deleted_days?: number
          dns_records?: Json
          domain?: string | null
          domain_status?: string
          junk_days?: number
          key_hint?: string | null
          key_vault_id?: string | null
          last_error?: string | null
          max_outside_day?: number
          max_outside_hour?: number
          microsoft_consent_at?: string | null
          microsoft_tenant?: string | null
          platform_dns_at?: string | null
          receiving_enabled?: boolean
          receiving_status?: string
          region?: string
          resend_domain_id?: string | null
          school_id?: string
          sending_enabled?: boolean
          updated_at?: string
          webhook_id?: string | null
          webhook_vault_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mail_settings_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: true
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      materials: {
        Row: {
          course_id: string
          created_at: string
          created_by: string | null
          description: string | null
          file_name: string | null
          file_path: string | null
          file_size: number | null
          id: string
          mime_type: string | null
          title: string
          url: string | null
        }
        Insert: {
          course_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          mime_type?: string | null
          title: string
          url?: string | null
        }
        Update: {
          course_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          mime_type?: string | null
          title?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "materials_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materials_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "result_slips"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "materials_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      member_module_access: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          level: string
          module: string
          school_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          level: string
          module: string
          school_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          level?: string
          module?: string
          school_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_module_access_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      message_comments: {
        Row: {
          body: string
          created_at: string
          edited_at: string | null
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          edited_at?: string | null
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_comments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          course_id: string
          created_at: string
          edited_at: string | null
          id: string
          user_id: string
        }
        Insert: {
          body: string
          course_id: string
          created_at?: string
          edited_at?: string | null
          id?: string
          user_id: string
        }
        Update: {
          body?: string
          course_id?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "result_slips"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      module_seen: {
        Row: {
          module: string
          school_id: string
          seen_at: string
          user_id: string
        }
        Insert: {
          module: string
          school_id: string
          seen_at?: string
          user_id: string
        }
        Update: {
          module?: string
          school_id?: string
          seen_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_seen_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      notice_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          notice_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          notice_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          notice_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notice_reactions_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "notice_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notice_reactions_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notice_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notice_replies: {
        Row: {
          body: string
          created_at: string
          edited_at: string | null
          id: string
          notice_id: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          edited_at?: string | null
          id?: string
          notice_id: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          notice_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notice_replies_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "notice_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notice_replies_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notice_replies_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notices: {
        Row: {
          audience: Database["classroom"]["Enums"]["notice_audience"]
          author_id: string | null
          body: string
          created_at: string
          edited_at: string | null
          event_at: string | null
          event_place: string | null
          id: string
          is_event: boolean
          pinned: boolean
          published_at: string | null
          school_id: string
          title: string
          updated_at: string
        }
        Insert: {
          audience?: Database["classroom"]["Enums"]["notice_audience"]
          author_id?: string | null
          body: string
          created_at?: string
          edited_at?: string | null
          event_at?: string | null
          event_place?: string | null
          id?: string
          is_event?: boolean
          pinned?: boolean
          published_at?: string | null
          school_id: string
          title: string
          updated_at?: string
        }
        Update: {
          audience?: Database["classroom"]["Enums"]["notice_audience"]
          author_id?: string | null
          body?: string
          created_at?: string
          edited_at?: string | null
          event_at?: string | null
          event_place?: string | null
          id?: string
          is_event?: boolean
          pinned?: boolean
          published_at?: string | null
          school_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notices_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notices_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_prefs: {
        Row: {
          chat_email: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          chat_email?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          chat_email?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          course_id: string | null
          created_at: string
          id: string
          kind: string
          link: string | null
          read_at: string | null
          ref_id: string | null
          school_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          course_id?: string | null
          created_at?: string
          id?: string
          kind: string
          link?: string | null
          read_at?: string | null
          ref_id?: string | null
          school_id?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          course_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          link?: string | null
          read_at?: string | null
          ref_id?: string | null
          school_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "result_slips"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "notifications_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      original_verifications: {
        Row: {
          application_id: string
          document_kind: string
          id: string
          remarks: string | null
          seen_at: string
          seen_by: string | null
        }
        Insert: {
          application_id: string
          document_kind: string
          id?: string
          remarks?: string | null
          seen_at?: string
          seen_by?: string | null
        }
        Update: {
          application_id?: string
          document_kind?: string
          id?: string
          remarks?: string | null
          seen_at?: string
          seen_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "original_verifications_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_gateways: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          id: string
          is_active: boolean
          mode: string | null
          provider: string | null
          public_config: Json
          require_confirmation: boolean
          school_id: string
          secret_vault_id: string | null
          updated_at: string
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          mode?: string | null
          provider?: string | null
          public_config?: Json
          require_confirmation?: boolean
          school_id: string
          secret_vault_id?: string | null
          updated_at?: string
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          mode?: string | null
          provider?: string | null
          public_config?: Json
          require_confirmation?: boolean
          school_id?: string
          secret_vault_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_gateways_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_gateways_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: true
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          gateway: string | null
          gateway_fee: number | null
          gateway_mode: string | null
          gateway_ref: string | null
          id: string
          invoice_id: string
          method: Database["classroom"]["Enums"]["payment_method"]
          note: string | null
          paid_on: string
          proof_path: string | null
          reference: string | null
          school_id: string
          status: Database["classroom"]["Enums"]["payment_status"]
          submitted_at: string
          submitted_by: string | null
        }
        Insert: {
          amount: number
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          gateway?: string | null
          gateway_fee?: number | null
          gateway_mode?: string | null
          gateway_ref?: string | null
          id?: string
          invoice_id: string
          method?: Database["classroom"]["Enums"]["payment_method"]
          note?: string | null
          paid_on?: string
          proof_path?: string | null
          reference?: string | null
          school_id: string
          status?: Database["classroom"]["Enums"]["payment_status"]
          submitted_at?: string
          submitted_by?: string | null
        }
        Update: {
          amount?: number
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          gateway?: string | null
          gateway_fee?: number | null
          gateway_mode?: string | null
          gateway_ref?: string | null
          id?: string
          invoice_id?: string
          method?: Database["classroom"]["Enums"]["payment_method"]
          note?: string | null
          paid_on?: string
          proof_path?: string | null
          reference?: string | null
          school_id?: string
          status?: Database["classroom"]["Enums"]["payment_status"]
          submitted_at?: string
          submitted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_balances"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "my_invoice_balances"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "payments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_deduction_types: {
        Row: {
          before_tax: boolean
          created_at: string
          id: string
          is_active: boolean
          label: string
          position: number
          school_id: string
        }
        Insert: {
          before_tax?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          position?: number
          school_id: string
        }
        Update: {
          before_tax?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          position?: number
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_deduction_types_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_payee_payments: {
        Row: {
          created_at: string
          description: string
          gross: number
          id: string
          net: number
          paid_from: string
          paid_on: string
          payee_id: string
          recorded_by: string | null
          reference: string | null
          school_id: string
          wht: number
          wht_rate: number
        }
        Insert: {
          created_at?: string
          description: string
          gross: number
          id?: string
          net: number
          paid_from?: string
          paid_on?: string
          payee_id: string
          recorded_by?: string | null
          reference?: string | null
          school_id: string
          wht: number
          wht_rate: number
        }
        Update: {
          created_at?: string
          description?: string
          gross?: number
          id?: string
          net?: number
          paid_from?: string
          paid_on?: string
          payee_id?: string
          recorded_by?: string | null
          reference?: string | null
          school_id?: string
          wht?: number
          wht_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_payee_payments_payee_id_fkey"
            columns: ["payee_id"]
            isOneToOne: false
            referencedRelation: "payroll_payees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_payee_payments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_payees: {
        Row: {
          account_name: string | null
          account_number: string | null
          bank_name: string | null
          created_at: string
          id: string
          is_active: boolean
          kind: string
          name: string
          school_id: string
          service: string | null
          tin: string | null
          wht_rate: number
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          bank_name?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          name: string
          school_id: string
          service?: string | null
          tin?: string | null
          wht_rate?: number
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          bank_name?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          school_id?: string
          service?: string | null
          tin?: string | null
          wht_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_payees_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          id: string
          note: string | null
          paid_by: string | null
          paid_on: string | null
          period: string
          prepared_at: string
          prepared_by: string | null
          returned_at: string | null
          returned_note: string | null
          school_id: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          id?: string
          note?: string | null
          paid_by?: string | null
          paid_on?: string | null
          period: string
          prepared_at?: string
          prepared_by?: string | null
          returned_at?: string | null
          returned_note?: string | null
          school_id: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          id?: string
          note?: string | null
          paid_by?: string | null
          paid_on?: string | null
          period?: string
          prepared_at?: string
          prepared_by?: string | null
          returned_at?: string | null
          returned_note?: string | null
          school_id?: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_settings: {
        Row: {
          approver_roles: Database["classroom"]["Enums"]["member_role"][]
          bands_confirmed_at: string | null
          bands_confirmed_by: string | null
          created_at: string
          fund_label: string
          nhf_percent: number
          pay_day: number | null
          paye_bands: Json
          paying_bank: string | null
          pension_employee_percent: number
          pension_employer_percent: number
          pension_label: string
          rent_relief_cap: number
          rent_relief_percent: number
          school_id: string
          tax_label: string
          tax_office: string | null
          updated_at: string
        }
        Insert: {
          approver_roles?: Database["classroom"]["Enums"]["member_role"][]
          bands_confirmed_at?: string | null
          bands_confirmed_by?: string | null
          created_at?: string
          fund_label?: string
          nhf_percent?: number
          pay_day?: number | null
          paye_bands?: Json
          paying_bank?: string | null
          pension_employee_percent?: number
          pension_employer_percent?: number
          pension_label?: string
          rent_relief_cap?: number
          rent_relief_percent?: number
          school_id: string
          tax_label?: string
          tax_office?: string | null
          updated_at?: string
        }
        Update: {
          approver_roles?: Database["classroom"]["Enums"]["member_role"][]
          bands_confirmed_at?: string | null
          bands_confirmed_by?: string | null
          created_at?: string
          fund_label?: string
          nhf_percent?: number
          pay_day?: number | null
          paye_bands?: Json
          paying_bank?: string | null
          pension_employee_percent?: number
          pension_employer_percent?: number
          pension_label?: string
          rent_relief_cap?: number
          rent_relief_percent?: number
          school_id?: string
          tax_label?: string
          tax_office?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_settings_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: true
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_staff: {
        Row: {
          account_name: string | null
          account_number: string | null
          annual_rent: number
          bank_name: string | null
          basic: number
          created_at: string
          end_date: string | null
          full_name: string
          housing: number
          id: string
          is_active: boolean
          job_title: string | null
          nhf_applies: boolean
          notes: string | null
          other_allowances: Json
          pension_applies: boolean
          pension_provider: string | null
          rsa_pin: string | null
          school_id: string
          start_date: string | null
          tin: string | null
          transport: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          annual_rent?: number
          bank_name?: string | null
          basic?: number
          created_at?: string
          end_date?: string | null
          full_name: string
          housing?: number
          id?: string
          is_active?: boolean
          job_title?: string | null
          nhf_applies?: boolean
          notes?: string | null
          other_allowances?: Json
          pension_applies?: boolean
          pension_provider?: string | null
          rsa_pin?: string | null
          school_id: string
          start_date?: string | null
          tin?: string | null
          transport?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          annual_rent?: number
          bank_name?: string | null
          basic?: number
          created_at?: string
          end_date?: string | null
          full_name?: string
          housing?: number
          id?: string
          is_active?: boolean
          job_title?: string | null
          nhf_applies?: boolean
          notes?: string | null
          other_allowances?: Json
          pension_applies?: boolean
          pension_provider?: string | null
          rsa_pin?: string | null
          school_id?: string
          start_date?: string | null
          tin?: string | null
          transport?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_staff_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_staff_deductions: {
        Row: {
          balance: number | null
          created_at: string
          ends_on: string | null
          id: string
          is_active: boolean
          kind: string
          note: string | null
          school_id: string
          staff_id: string
          starts_on: string | null
          type_id: string
          value: number
        }
        Insert: {
          balance?: number | null
          created_at?: string
          ends_on?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          note?: string | null
          school_id: string
          staff_id: string
          starts_on?: string | null
          type_id: string
          value: number
        }
        Update: {
          balance?: number | null
          created_at?: string
          ends_on?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          note?: string | null
          school_id?: string
          staff_id?: string
          starts_on?: string | null
          type_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_staff_deductions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_staff_deductions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "payroll_staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_staff_deductions_type_id_fkey"
            columns: ["type_id"]
            isOneToOne: false
            referencedRelation: "payroll_deduction_types"
            referencedColumns: ["id"]
          },
        ]
      }
      payslips: {
        Row: {
          account_name: string | null
          account_number: string | null
          bank_name: string | null
          created_at: string
          days_factor: number
          deductions: Json
          earnings: Json
          full_name: string
          gross: number
          id: string
          job_title: string | null
          net: number
          nhf: number
          other_deductions: number
          paye: number
          pension_employee: number
          pension_employer: number
          pension_provider: string | null
          rent_relief: number
          rsa_pin: string | null
          run_id: string
          school_id: string
          staff_id: string | null
          taxable_annual: number
          tin: string | null
          user_id: string | null
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          bank_name?: string | null
          created_at?: string
          days_factor?: number
          deductions?: Json
          earnings?: Json
          full_name: string
          gross?: number
          id?: string
          job_title?: string | null
          net?: number
          nhf?: number
          other_deductions?: number
          paye?: number
          pension_employee?: number
          pension_employer?: number
          pension_provider?: string | null
          rent_relief?: number
          rsa_pin?: string | null
          run_id: string
          school_id: string
          staff_id?: string | null
          taxable_annual?: number
          tin?: string | null
          user_id?: string | null
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          bank_name?: string | null
          created_at?: string
          days_factor?: number
          deductions?: Json
          earnings?: Json
          full_name?: string
          gross?: number
          id?: string
          job_title?: string | null
          net?: number
          nhf?: number
          other_deductions?: number
          paye?: number
          pension_employee?: number
          pension_employer?: number
          pension_provider?: string | null
          rent_relief?: number
          rsa_pin?: string | null
          run_id?: string
          school_id?: string
          staff_id?: string | null
          taxable_annual?: number
          tin?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payslips_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payslips_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payslips_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "payroll_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_access_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decline_note: string | null
          expires_at: string | null
          hours: number | null
          id: string
          reason: string
          school_id: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decline_note?: string | null
          expires_at?: string | null
          hours?: number | null
          id?: string
          reason: string
          school_id: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decline_note?: string | null
          expires_at?: string | null
          hours?: number | null
          id?: string
          reason?: string
          school_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_access_requests_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          access_type: string
          created_at: string
          user_id: string
        }
        Insert: {
          access_type?: string
          created_at?: string
          user_id: string
        }
        Update: {
          access_type?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_admins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_plan_prices: {
        Row: {
          currency: string
          growth: number
          starter: number
          updated_at: string
        }
        Insert: {
          currency: string
          growth: number
          starter: number
          updated_at?: string
        }
        Update: {
          currency?: string
          growth?: number
          starter?: number
          updated_at?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          contact_email: string
          id: boolean
          microsoft_client_id: string | null
          microsoft_secret_id: string | null
          paystack_public_key: string | null
          paystack_secret_id: string | null
          sender_address: string | null
          sender_name: string
          smtp_host: string | null
          smtp_port: number | null
          smtp_secret_id: string | null
          smtp_security: string | null
          smtp_username: string | null
          updated_at: string
          vercel_secret_id: string | null
          vercel_team_id: string | null
        }
        Insert: {
          contact_email?: string
          id?: boolean
          microsoft_client_id?: string | null
          microsoft_secret_id?: string | null
          paystack_public_key?: string | null
          paystack_secret_id?: string | null
          sender_address?: string | null
          sender_name?: string
          smtp_host?: string | null
          smtp_port?: number | null
          smtp_secret_id?: string | null
          smtp_security?: string | null
          smtp_username?: string | null
          updated_at?: string
          vercel_secret_id?: string | null
          vercel_team_id?: string | null
        }
        Update: {
          contact_email?: string
          id?: boolean
          microsoft_client_id?: string | null
          microsoft_secret_id?: string | null
          paystack_public_key?: string | null
          paystack_secret_id?: string | null
          sender_address?: string | null
          sender_name?: string
          smtp_host?: string | null
          smtp_port?: number | null
          smtp_secret_id?: string | null
          smtp_security?: string | null
          smtp_username?: string | null
          updated_at?: string
          vercel_secret_id?: string | null
          vercel_team_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          email: string | null
          first_name: string
          id: string
          level_year: number | null
          must_change_password: boolean
          role: Database["classroom"]["Enums"]["user_role"]
          surname: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          email?: string | null
          first_name?: string
          id: string
          level_year?: number | null
          must_change_password?: boolean
          role?: Database["classroom"]["Enums"]["user_role"]
          surname?: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          email?: string | null
          first_name?: string
          id?: string
          level_year?: number | null
          must_change_password?: boolean
          role?: Database["classroom"]["Enums"]["user_role"]
          surname?: string
          username?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_seen_at: string
          p256dh: string
          school_id: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_seen_at?: string
          p256dh: string
          school_id?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_seen_at?: string
          p256dh?: string
          school_id?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      result_entries: {
        Row: {
          ca_score: number | null
          exam_score: number | null
          id: string
          remark: string | null
          sheet_id: string
          student_id: string
          total: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ca_score?: number | null
          exam_score?: number | null
          id?: string
          remark?: string | null
          sheet_id: string
          student_id: string
          total?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ca_score?: number | null
          exam_score?: number | null
          id?: string
          remark?: string | null
          sheet_id?: string
          student_id?: string
          total?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "result_entries_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "result_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_entries_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "result_slips"
            referencedColumns: ["sheet_id"]
          },
          {
            foreignKeyName: "result_entries_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_entries_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      result_events: {
        Row: {
          actor_id: string | null
          actor_label: string | null
          created_at: string
          id: string
          note: string | null
          sheet_id: string
          status_from: Database["classroom"]["Enums"]["result_status"] | null
          status_to: Database["classroom"]["Enums"]["result_status"]
        }
        Insert: {
          actor_id?: string | null
          actor_label?: string | null
          created_at?: string
          id?: string
          note?: string | null
          sheet_id: string
          status_from?: Database["classroom"]["Enums"]["result_status"] | null
          status_to: Database["classroom"]["Enums"]["result_status"]
        }
        Update: {
          actor_id?: string | null
          actor_label?: string | null
          created_at?: string
          id?: string
          note?: string | null
          sheet_id?: string
          status_from?: Database["classroom"]["Enums"]["result_status"] | null
          status_to?: Database["classroom"]["Enums"]["result_status"]
        }
        Relationships: [
          {
            foreignKeyName: "result_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_events_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "result_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_events_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "result_slips"
            referencedColumns: ["sheet_id"]
          },
        ]
      }
      result_sheets: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          ca_max: number
          course_id: string
          created_at: string
          created_by: string | null
          exam_max: number
          id: string
          released_at: string | null
          released_by: string | null
          school_id: string
          status: Database["classroom"]["Enums"]["result_status"]
          submitted_at: string | null
          submitted_by: string | null
          term_id: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          ca_max?: number
          course_id: string
          created_at?: string
          created_by?: string | null
          exam_max?: number
          id?: string
          released_at?: string | null
          released_by?: string | null
          school_id: string
          status?: Database["classroom"]["Enums"]["result_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          term_id: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          ca_max?: number
          course_id?: string
          created_at?: string
          created_by?: string | null
          exam_max?: number
          id?: string
          released_at?: string | null
          released_by?: string | null
          school_id?: string
          status?: Database["classroom"]["Enums"]["result_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          term_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "result_sheets_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_sheets_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_sheets_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "result_slips"
            referencedColumns: ["course_id"]
          },
          {
            foreignKeyName: "result_sheets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_sheets_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_sheets_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_sheets_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_sheets_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "result_slips"
            referencedColumns: ["term_id"]
          },
          {
            foreignKeyName: "result_sheets_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      school_attendance_records: {
        Row: {
          created_at: string
          id: string
          note: string | null
          person_id: string
          recorded_by: string | null
          resumed_at: string
          school_id: string
          source: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          person_id: string
          recorded_by?: string | null
          resumed_at: string
          school_id: string
          source?: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          person_id?: string
          recorded_by?: string | null
          resumed_at?: string
          school_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_attendance_records_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_attendance_records_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_attendance_records_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      school_members: {
        Row: {
          access_expires_at: string | null
          created_at: string
          granted_by: string | null
          granted_via: string | null
          id: string
          is_active: boolean
          job_title: string | null
          manager_id: string | null
          role: Database["classroom"]["Enums"]["member_role"]
          school_id: string
          user_id: string
        }
        Insert: {
          access_expires_at?: string | null
          created_at?: string
          granted_by?: string | null
          granted_via?: string | null
          id?: string
          is_active?: boolean
          job_title?: string | null
          manager_id?: string | null
          role?: Database["classroom"]["Enums"]["member_role"]
          school_id: string
          user_id: string
        }
        Update: {
          access_expires_at?: string | null
          created_at?: string
          granted_by?: string | null
          granted_via?: string | null
          id?: string
          is_active?: boolean
          job_title?: string | null
          manager_id?: string | null
          role?: Database["classroom"]["Enums"]["member_role"]
          school_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_members_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_members_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      schools: {
        Row: {
          address: string | null
          admission_letter_closing: string | null
          admission_letter_enrolled_intro: string | null
          admission_letter_offer_intro: string | null
          ai_token_limit: number
          allow_self_signup: boolean
          archived_at: string | null
          country: string | null
          created_at: string
          currency: string
          disabled_modules: string[]
          email: string | null
          id: string
          idle_lockout_enabled: boolean
          idle_lockout_minutes: number
          is_active: boolean
          logo_url: string | null
          name: string
          paid_until: string | null
          phone: string | null
          plan: string
          signatory_name: string | null
          signatory_title: string | null
          signature_url: string | null
          slug: string
          theme_color: string | null
          timezone: string
          trial_ends_at: string | null
        }
        Insert: {
          address?: string | null
          admission_letter_closing?: string | null
          admission_letter_enrolled_intro?: string | null
          admission_letter_offer_intro?: string | null
          ai_token_limit?: number
          allow_self_signup?: boolean
          archived_at?: string | null
          country?: string | null
          created_at?: string
          currency?: string
          disabled_modules?: string[]
          email?: string | null
          id?: string
          idle_lockout_enabled?: boolean
          idle_lockout_minutes?: number
          is_active?: boolean
          logo_url?: string | null
          name: string
          paid_until?: string | null
          phone?: string | null
          plan?: string
          signatory_name?: string | null
          signatory_title?: string | null
          signature_url?: string | null
          slug: string
          theme_color?: string | null
          timezone?: string
          trial_ends_at?: string | null
        }
        Update: {
          address?: string | null
          admission_letter_closing?: string | null
          admission_letter_enrolled_intro?: string | null
          admission_letter_offer_intro?: string | null
          ai_token_limit?: number
          allow_self_signup?: boolean
          archived_at?: string | null
          country?: string | null
          created_at?: string
          currency?: string
          disabled_modules?: string[]
          email?: string | null
          id?: string
          idle_lockout_enabled?: boolean
          idle_lockout_minutes?: number
          is_active?: boolean
          logo_url?: string | null
          name?: string
          paid_until?: string | null
          phone?: string | null
          plan?: string
          signatory_name?: string | null
          signatory_title?: string | null
          signature_url?: string | null
          slug?: string
          theme_color?: string | null
          timezone?: string
          trial_ends_at?: string | null
        }
        Relationships: []
      }
      screening_requirements: {
        Row: {
          created_at: string
          id: string
          is_required: boolean
          kind: string
          label: string
          notes: string | null
          position: number
          programme_id: string | null
          school_id: string
          session_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_required?: boolean
          kind: string
          label: string
          notes?: string | null
          position?: number
          programme_id?: string | null
          school_id: string
          session_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_required?: boolean
          kind?: string
          label?: string
          notes?: string | null
          position?: number
          programme_id?: string | null
          school_id?: string
          session_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "screening_requirements_programme_id_fkey"
            columns: ["programme_id"]
            isOneToOne: false
            referencedRelation: "admission_programmes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_requirements_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screening_requirements_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          applications_open: boolean
          created_at: string
          ends_on: string | null
          id: string
          is_current: boolean
          name: string
          school_id: string
          starts_on: string | null
        }
        Insert: {
          applications_open?: boolean
          created_at?: string
          ends_on?: string | null
          id?: string
          is_current?: boolean
          name: string
          school_id: string
          starts_on?: string | null
        }
        Update: {
          applications_open?: boolean
          created_at?: string
          ends_on?: string | null
          id?: string
          is_current?: boolean
          name?: string
          school_id?: string
          starts_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sessions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      store_products: {
        Row: {
          category: string
          cost_price: number
          created_at: string
          id: string
          is_active: boolean
          name: string
          net_cost: number | null
          reorder_level: number
          school_id: string
          sell_price: number
          size: string | null
          stock_qty: number
          supplier: string | null
          trade_discount: number
          unit_profit: number | null
          updated_at: string
        }
        Insert: {
          category: string
          cost_price?: number
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          net_cost?: number | null
          reorder_level?: number
          school_id: string
          sell_price?: number
          size?: string | null
          stock_qty?: number
          supplier?: string | null
          trade_discount?: number
          unit_profit?: number | null
          updated_at?: string
        }
        Update: {
          category?: string
          cost_price?: number
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          net_cost?: number | null
          reorder_level?: number
          school_id?: string
          sell_price?: number
          size?: string | null
          stock_qty?: number
          supplier?: string | null
          trade_discount?: number
          unit_profit?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_products_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      store_sale_items: {
        Row: {
          category: string
          id: string
          name: string
          product_id: string
          qty: number
          sale_id: string
          size: string | null
          unit_cost: number
          unit_price: number
        }
        Insert: {
          category: string
          id?: string
          name: string
          product_id: string
          qty: number
          sale_id: string
          size?: string | null
          unit_cost: number
          unit_price: number
        }
        Update: {
          category?: string
          id?: string
          name?: string
          product_id?: string
          qty?: number
          sale_id?: string
          size?: string | null
          unit_cost?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "store_sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "store_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "store_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      store_sales: {
        Row: {
          buyer_name: string | null
          cost_total: number
          id: string
          invoice_id: string | null
          note: string | null
          payment: string
          reference: string
          school_id: string
          seq: number
          sold_at: string
          sold_by: string | null
          student_id: string | null
          total: number
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          buyer_name?: string | null
          cost_total: number
          id?: string
          invoice_id?: string | null
          note?: string | null
          payment: string
          reference: string
          school_id: string
          seq: number
          sold_at?: string
          sold_by?: string | null
          student_id?: string | null
          total: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          buyer_name?: string | null
          cost_total?: number
          id?: string
          invoice_id?: string | null
          note?: string | null
          payment?: string
          reference?: string
          school_id?: string
          seq?: number
          sold_at?: string
          sold_by?: string | null
          student_id?: string | null
          total?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_sales_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_balances"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "store_sales_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_sales_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "my_invoice_balances"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "store_sales_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_sales_sold_by_fkey"
            columns: ["sold_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_sales_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_sales_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      store_stock_movements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kind: string
          note: string | null
          product_id: string
          qty: number
          sale_id: string | null
          school_id: string
          unit_cost: number | null
          unit_discount: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          note?: string | null
          product_id: string
          qty: number
          sale_id?: string | null
          school_id: string
          unit_cost?: number | null
          unit_discount?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          note?: string | null
          product_id?: string
          qty?: number
          sale_id?: string | null
          school_id?: string
          unit_cost?: number | null
          unit_discount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "store_stock_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "store_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_stock_movements_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "store_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_stock_movements_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      student_registrations: {
        Row: {
          application_id: string | null
          class_id: string | null
          created_at: string
          id: string
          notes: string | null
          registered_at: string
          registered_by: string | null
          registration_number: string
          school_id: string
          session_id: string | null
          status: string
          student_id: string
          updated_at: string
        }
        Insert: {
          application_id?: string | null
          class_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          registered_at?: string
          registered_by?: string | null
          registration_number: string
          school_id: string
          session_id?: string | null
          status?: string
          student_id: string
          updated_at?: string
        }
        Update: {
          application_id?: string | null
          class_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          registered_at?: string
          registered_by?: string | null
          registration_number?: string
          school_id?: string
          session_id?: string | null
          status?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_registrations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_registrations_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_registrations_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_registrations_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_registrations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subjects: {
        Row: {
          code: string | null
          created_at: string
          id: string
          name: string
          school_id: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          name: string
          school_id: string
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          name?: string
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subjects_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      submissions: {
        Row: {
          assignment_id: string
          body: string | null
          feedback: string | null
          file_name: string | null
          file_path: string | null
          file_size: number | null
          grade: number | null
          graded_at: string | null
          graded_by: string | null
          id: string
          submitted_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          assignment_id: string
          body?: string | null
          feedback?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          grade?: number | null
          graded_at?: string | null
          graded_by?: string | null
          id?: string
          submitted_at?: string
          url?: string | null
          user_id: string
        }
        Update: {
          assignment_id?: string
          body?: string | null
          feedback?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          grade?: number | null
          graded_at?: string | null
          graded_by?: string | null
          id?: string
          submitted_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "submissions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_graded_by_fkey"
            columns: ["graded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          gateway_response: Json | null
          id: string
          paid_at: string | null
          period_end: string | null
          period_start: string | null
          plan: string
          reference: string
          school_id: string
          started_by: string | null
          status: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          gateway_response?: Json | null
          id?: string
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          plan: string
          reference: string
          school_id: string
          started_by?: string | null
          status?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          gateway_response?: Json | null
          id?: string
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          plan?: string
          reference?: string
          school_id?: string
          started_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_payments_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_reminders: {
        Row: {
          days_before: number
          ends_on: string
          kind: string
          school_id: string
          sent_at: string
        }
        Insert: {
          days_before: number
          ends_on: string
          kind: string
          school_id: string
          sent_at?: string
        }
        Update: {
          days_before?: number
          ends_on?: string
          kind?: string
          school_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_reminders_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      terms: {
        Row: {
          created_at: string
          ends_on: string | null
          id: string
          is_current: boolean
          name: string
          position: number
          school_id: string
          session_id: string
          starts_on: string | null
        }
        Insert: {
          created_at?: string
          ends_on?: string | null
          id?: string
          is_current?: boolean
          name: string
          position?: number
          school_id: string
          session_id: string
          starts_on?: string | null
        }
        Update: {
          created_at?: string
          ends_on?: string | null
          id?: string
          is_current?: boolean
          name?: string
          position?: number
          school_id?: string
          session_id?: string
          starts_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "terms_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terms_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_groups: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          position: number
          role: Database["classroom"]["Enums"]["member_role"] | null
          school_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          position?: number
          role?: Database["classroom"]["Enums"]["member_role"] | null
          school_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          position?: number
          role?: Database["classroom"]["Enums"]["member_role"] | null
          school_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_groups_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_mailboxes: {
        Row: {
          address: string
          created_at: string
          display_name: string | null
          id: string
          imap_host: string | null
          imap_port: number | null
          imap_security: string | null
          is_active: boolean
          label: string
          last_poll_at: string | null
          last_poll_error: string | null
          last_poll_status: string | null
          oauth_connected_email: string | null
          oauth_tenant_id: string | null
          oauth_vault_id: string | null
          provider: string
          school_id: string
          secret_vault_id: string | null
          smtp_host: string | null
          smtp_port: number | null
          smtp_security: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          address: string
          created_at?: string
          display_name?: string | null
          id?: string
          imap_host?: string | null
          imap_port?: number | null
          imap_security?: string | null
          is_active?: boolean
          label?: string
          last_poll_at?: string | null
          last_poll_error?: string | null
          last_poll_status?: string | null
          oauth_connected_email?: string | null
          oauth_tenant_id?: string | null
          oauth_vault_id?: string | null
          provider?: string
          school_id: string
          secret_vault_id?: string | null
          smtp_host?: string | null
          smtp_port?: number | null
          smtp_security?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          address?: string
          created_at?: string
          display_name?: string | null
          id?: string
          imap_host?: string | null
          imap_port?: number | null
          imap_security?: string | null
          is_active?: boolean
          label?: string
          last_poll_at?: string | null
          last_poll_error?: string | null
          last_poll_status?: string | null
          oauth_connected_email?: string | null
          oauth_tenant_id?: string | null
          oauth_vault_id?: string | null
          provider?: string
          school_id?: string
          secret_vault_id?: string | null
          smtp_host?: string | null
          smtp_port?: number | null
          smtp_security?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ticket_mailboxes_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_messages: {
        Row: {
          author_id: string | null
          bcc_addresses: string[] | null
          body: string
          body_format: string
          cc_addresses: string[] | null
          created_at: string
          direction: string
          email_message_id: string | null
          external_from: string | null
          id: string
          in_reply_to: string | null
          kind: string
          send_error: string | null
          send_status: string | null
          ticket_id: string
          to_addresses: string[] | null
        }
        Insert: {
          author_id?: string | null
          bcc_addresses?: string[] | null
          body: string
          body_format?: string
          cc_addresses?: string[] | null
          created_at?: string
          direction?: string
          email_message_id?: string | null
          external_from?: string | null
          id?: string
          in_reply_to?: string | null
          kind?: string
          send_error?: string | null
          send_status?: string | null
          ticket_id: string
          to_addresses?: string[] | null
        }
        Update: {
          author_id?: string | null
          bcc_addresses?: string[] | null
          body?: string
          body_format?: string
          cc_addresses?: string[] | null
          created_at?: string
          direction?: string
          email_message_id?: string | null
          external_from?: string | null
          id?: string
          in_reply_to?: string | null
          kind?: string
          send_error?: string | null
          send_status?: string | null
          ticket_id?: string
          to_addresses?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "ticket_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          assigned_to: string | null
          channel: string
          closed_at: string | null
          created_at: string
          description: string
          description_format: string
          first_response_at: string | null
          group_id: string | null
          id: string
          mailbox_id: string | null
          number: number
          origin_message_id: string | null
          priority: string
          requester_email: string | null
          requester_id: string | null
          requester_name: string | null
          resolved_at: string | null
          school_id: string
          status: string
          subject: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          channel?: string
          closed_at?: string | null
          created_at?: string
          description: string
          description_format?: string
          first_response_at?: string | null
          group_id?: string | null
          id?: string
          mailbox_id?: string | null
          number: number
          origin_message_id?: string | null
          priority?: string
          requester_email?: string | null
          requester_id?: string | null
          requester_name?: string | null
          resolved_at?: string | null
          school_id: string
          status?: string
          subject: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          channel?: string
          closed_at?: string | null
          created_at?: string
          description?: string
          description_format?: string
          first_response_at?: string | null
          group_id?: string | null
          id?: string
          mailbox_id?: string | null
          number?: number
          origin_message_id?: string | null
          priority?: string
          requester_email?: string | null
          requester_id?: string | null
          requester_name?: string | null
          resolved_at?: string | null
          school_id?: string
          status?: string
          subject?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickets_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "ticket_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "ticket_mailboxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      timetable_periods: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          is_break: boolean
          name: string
          position: number
          school_id: string
          starts_at: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          is_break?: boolean
          name: string
          position?: number
          school_id: string
          starts_at: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          is_break?: boolean
          name?: string
          position?: number
          school_id?: string
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "timetable_periods_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      timetable_settings: {
        Row: {
          days: number[]
          school_id: string
          updated_at: string
        }
        Insert: {
          days?: number[]
          school_id: string
          updated_at?: string
        }
        Update: {
          days?: number[]
          school_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "timetable_settings_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: true
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      timetable_slots: {
        Row: {
          class_id: string
          class_subject_id: string | null
          created_by: string | null
          day: number
          id: string
          label: string | null
          period_id: string
          room: string | null
          school_id: string
          teacher_id: string | null
          term_id: string
          updated_at: string
        }
        Insert: {
          class_id: string
          class_subject_id?: string | null
          created_by?: string | null
          day: number
          id?: string
          label?: string | null
          period_id: string
          room?: string | null
          school_id: string
          teacher_id?: string | null
          term_id: string
          updated_at?: string
        }
        Update: {
          class_id?: string
          class_subject_id?: string | null
          created_by?: string | null
          day?: number
          id?: string
          label?: string | null
          period_id?: string
          room?: string | null
          school_id?: string
          teacher_id?: string | null
          term_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "timetable_slots_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_slots_class_subject_id_fkey"
            columns: ["class_subject_id"]
            isOneToOne: false
            referencedRelation: "class_subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_slots_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "timetable_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_slots_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timetable_slots_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "result_slips"
            referencedColumns: ["term_id"]
          },
          {
            foreignKeyName: "timetable_slots_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      user_presence: {
        Row: {
          last_seen_at: string
          user_id: string
        }
        Insert: {
          last_seen_at?: string
          user_id: string
        }
        Update: {
          last_seen_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      invoice_balances: {
        Row: {
          applicant_name: string | null
          awaiting_approval: number | null
          balance: number | null
          class_id: string | null
          discount: number | null
          discount_reason: string | null
          due_on: string | null
          gross: number | null
          invoice_id: string | null
          issued_at: string | null
          paid: number | null
          payable: number | null
          purpose: string | null
          reference: string | null
          school_id: string | null
          session_id: string | null
          standing: string | null
          status: Database["classroom"]["Enums"]["invoice_status"] | null
          student_id: string | null
          term_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "result_slips"
            referencedColumns: ["term_id"]
          },
          {
            foreignKeyName: "invoices_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      my_invoice_balances: {
        Row: {
          applicant_name: string | null
          awaiting_approval: number | null
          balance: number | null
          class_id: string | null
          discount: number | null
          discount_reason: string | null
          due_on: string | null
          gross: number | null
          invoice_id: string | null
          issued_at: string | null
          paid: number | null
          payable: number | null
          purpose: string | null
          reference: string | null
          school_id: string | null
          session_id: string | null
          standing: string | null
          status: Database["classroom"]["Enums"]["invoice_status"] | null
          student_id: string | null
          term_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "result_slips"
            referencedColumns: ["term_id"]
          },
          {
            foreignKeyName: "invoices_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      notice_feed: {
        Row: {
          audience: Database["classroom"]["Enums"]["notice_audience"] | null
          author_id: string | null
          author_name: string | null
          body: string | null
          created_at: string | null
          edited_at: string | null
          event_at: string | null
          event_place: string | null
          id: string | null
          is_event: boolean | null
          pinned: boolean | null
          published_at: string | null
          replies: number | null
          school_id: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notices_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notices_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      result_slips: {
        Row: {
          ca_max: number | null
          ca_score: number | null
          course_code: string | null
          course_id: string | null
          course_title: string | null
          entry_id: string | null
          exam_max: number | null
          exam_score: number | null
          grade: string | null
          percentage: number | null
          released_at: string | null
          remark: string | null
          school_id: string | null
          session_name: string | null
          sheet_id: string | null
          status: Database["classroom"]["Enums"]["result_status"] | null
          student_id: string | null
          term_id: string | null
          term_name: string | null
          total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "result_entries_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "result_sheets_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_offer: {
        Args: { target_offer: string }
        Returns: {
          address: string | null
          applicant_id: string | null
          applying_for_level: number | null
          assigned_reviewer_id: string | null
          class_id: string | null
          clearance_state: string
          correction_reason: string | null
          correction_requested_at: string | null
          correction_requested_by: string | null
          correction_resubmitted_at: string | null
          correction_sections: string[] | null
          created_at: string
          date_of_birth: string | null
          decided_at: string | null
          decided_by: string | null
          decision_state: string
          declaration_accepted_at: string | null
          document_links: string | null
          documents_state: string
          education_history: Json | null
          exam_results: Json | null
          final_decided_at: string | null
          final_decided_by: string | null
          final_decision_note: string | null
          first_name: string
          form_state: string
          gender: string | null
          guardian_email: string
          guardian_name: string
          guardian_phone: string | null
          guardian_relation: string | null
          id: string
          interview_state: string
          it_ticket_id: string | null
          middle_name: string | null
          next_of_kin: Json | null
          notes: string | null
          offer_expires_at: string | null
          offer_state: string
          payment_state: string
          personal_info: Json | null
          previous_school: string | null
          programme_id: string | null
          referees: Json | null
          reference: string
          registration_state: string
          review_completed_at: string | null
          review_state: string
          school_id: string
          screening_completed_at: string | null
          screening_state: string
          seq: number
          session_id: string | null
          status: Database["classroom"]["Enums"]["application_status"]
          student_account_id: string | null
          student_id: string | null
          submitted_at: string | null
          submitted_snapshot: Json | null
          surname: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      account_balances: {
        Args: { from_date?: string; target_school: string; to_date?: string }
        Returns: {
          account_id: string
          closing: number
          code: string
          credit: number
          debit: number
          description: string
          is_active: boolean
          name: string
          opening: number
          system_key: string
          type: string
        }[]
      }
      accounting_backfill: { Args: { target_school: string }; Returns: number }
      accounting_setup: {
        Args: { restock_from?: string; start_on: string; target_school: string }
        Returns: number
      }
      acct_enabled: {
        Args: { on_date: string; target_school: string }
        Returns: boolean
      }
      acct_invoice_label: { Args: { target_invoice: string }; Returns: string }
      acct_invoice_lines: { Args: { target_invoice: string }; Returns: Json }
      acct_local_date: {
        Args: { at: string; target_school: string }
        Returns: string
      }
      acct_post: {
        Args: {
          memo_in: string
          on_date: string
          post_lines: Json
          src_event: string
          src_id: string
          src_type: string
          target_school: string
        }
        Returns: string
      }
      acct_post_invoice: {
        Args: { event: string; target_invoice: string }
        Returns: undefined
      }
      acct_post_payment: {
        Args: { target_payment: string }
        Returns: undefined
      }
      acct_post_stock_movement: {
        Args: { target_movement: string }
        Returns: undefined
      }
      acct_post_store_sale: {
        Args: { event: string; target_sale: string }
        Returns: undefined
      }
      acct_seed_chart: { Args: { target_school: string }; Returns: undefined }
      acct_seed_payroll_accounts: {
        Args: { target_school: string }
        Returns: undefined
      }
      acct_store_sale_lines: { Args: { target_sale: string }; Returns: Json }
      acct_swap: { Args: { lines: Json }; Returns: Json }
      actor_label: { Args: never; Returns: string }
      add_chat_members: {
        Args: { member_ids: string[]; target_channel: string }
        Returns: undefined
      }
      add_ticket_message: {
        Args: {
          body_in: string
          kind_in: string
          target_school: string
          target_ticket: string
        }
        Returns: {
          author_id: string | null
          bcc_addresses: string[] | null
          body: string
          body_format: string
          cc_addresses: string[] | null
          created_at: string
          direction: string
          email_message_id: string | null
          external_from: string | null
          id: string
          in_reply_to: string | null
          kind: string
          send_error: string | null
          send_status: string | null
          ticket_id: string
          to_addresses: string[] | null
        }
        SetofOptions: {
          from: "*"
          to: "ticket_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      adjust_store_stock: {
        Args: { qty_change: number; reason: string; target_product: string }
        Returns: {
          category: string
          cost_price: number
          created_at: string
          id: string
          is_active: boolean
          name: string
          net_cost: number | null
          reorder_level: number
          school_id: string
          sell_price: number
          size: string | null
          stock_qty: number
          supplier: string | null
          trade_discount: number
          unit_profit: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "store_products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admissions_actor_label: { Args: never; Returns: string }
      admissions_queues: {
        Args: { target_school: string }
        Returns: {
          applicant: string
          application_id: string
          bucket: string
          documents_state: string
          form_state: string
          interview_state: string
          payment_state: string
          reference: string
          review_state: string
          screening_state: string
          status: Database["classroom"]["Enums"]["application_status"]
          submitted_at: string
          updated_at: string
        }[]
      }
      admissions_summary: {
        Args: { target_school: string }
        Returns: {
          count: number
          status: Database["classroom"]["Enums"]["application_status"]
        }[]
      }
      ai_allowance: { Args: { target_school: string }; Returns: Json }
      ai_catalog: { Args: never; Returns: Json }
      ai_functions: { Args: never; Returns: Json }
      ai_tokens_this_month: { Args: { target_school: string }; Returns: number }
      ai_whoami: { Args: never; Returns: string }
      application_workflow_steps: {
        Args: { target_application: string }
        Returns: {
          state: string
          step_key: string
          step_label: string
        }[]
      }
      application_workspace: {
        Args: { target_application: string; target_school: string }
        Returns: Json
      }
      apply_discount_rule: {
        Args: { target_invoice: string; target_rule: string }
        Returns: {
          application_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          class_id: string | null
          created_at: string
          created_by: string | null
          discount: number
          discount_reason: string | null
          discount_rule_id: string | null
          due_on: string | null
          id: string
          issued_at: string | null
          issued_by: string | null
          notes: string | null
          purpose: string
          reference: string
          school_id: string
          seq: number
          session_id: string
          status: Database["classroom"]["Enums"]["invoice_status"]
          structure_id: string | null
          student_id: string | null
          term_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_payment: {
        Args: { decision?: string; target_payment: string }
        Returns: {
          amount: number
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          gateway: string | null
          gateway_fee: number | null
          gateway_mode: string | null
          gateway_ref: string | null
          id: string
          invoice_id: string
          method: Database["classroom"]["Enums"]["payment_method"]
          note: string | null
          paid_on: string
          proof_path: string | null
          reference: string | null
          school_id: string
          status: Database["classroom"]["Enums"]["payment_status"]
          submitted_at: string
          submitted_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_result_sheet: {
        Args: { note?: string; target_sheet: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          ca_max: number
          course_id: string
          created_at: string
          created_by: string | null
          exam_max: number
          id: string
          released_at: string | null
          released_by: string | null
          school_id: string
          status: Database["classroom"]["Enums"]["result_status"]
          submitted_at: string | null
          submitted_by: string | null
          term_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "result_sheets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_review: {
        Args: {
          target_application: string
          target_reviewer: string
          target_school: string
        }
        Returns: {
          academic_score: number | null
          application_id: string
          assigned_at: string
          assigned_by: string | null
          completed_at: string | null
          created_at: string
          id: string
          interview_score: number | null
          notes: string | null
          recommendation: string | null
          reviewer_id: string
          total_score: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "application_reviews"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attempt_deadline: { Args: { target_attempt: string }; Returns: string }
      attempt_is_open: { Args: { target_attempt: string }; Returns: boolean }
      audit_addresses: { Args: { list: Json }; Returns: Json }
      audit_archive_remove: {
        Args: { archived_ids: string[] }
        Returns: number
      }
      audit_archive_take: {
        Args: { batch_size?: number }
        Returns: {
          action: string
          actor_id: string | null
          actor_label: string | null
          actor_role: string | null
          changed_fields: string[] | null
          country: string | null
          created_at: string
          id: string
          ip_address: string | null
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          school_id: string | null
          table_name: string
          user_agent: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "audit_log"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      audit_log_tables: { Args: { target_school: string }; Returns: string[] }
      audit_write: {
        Args: {
          act: string
          actor: string
          data: Json
          rec: string
          school: string
          tbl: string
        }
        Returns: undefined
      }
      can_access_ticket: { Args: { target_ticket: string }; Returns: boolean }
      can_do_accounts: { Args: { target_school: string }; Returns: boolean }
      can_do_admissions: { Args: { target_school: string }; Returns: boolean }
      can_do_bursary: { Args: { target_school: string }; Returns: boolean }
      can_do_payroll: { Args: { target_school: string }; Returns: boolean }
      can_do_store: { Args: { target_school: string }; Returns: boolean }
      can_finalise_admission: {
        Args: { target_school: string }
        Returns: boolean
      }
      can_manage_assignment: {
        Args: { target_assignment: string }
        Returns: boolean
      }
      can_manage_course: { Args: { target_course: string }; Returns: boolean }
      can_manage_member_account: {
        Args: { target_school: string; target_user: string }
        Returns: boolean
      }
      can_manage_timetable: {
        Args: { target_school: string }
        Returns: boolean
      }
      can_mark_attendance: { Args: { target_class: string }; Returns: boolean }
      can_post_notices: { Args: { target_school: string }; Returns: boolean }
      can_release_results: { Args: { target_school: string }; Returns: boolean }
      can_see_envelope: { Args: { target_envelope: string }; Returns: boolean }
      can_see_person: { Args: { target: string }; Returns: boolean }
      can_view_accounts: { Args: { target_school: string }; Returns: boolean }
      can_view_admissions: { Args: { target_school: string }; Returns: boolean }
      can_view_bursary: { Args: { target_school: string }; Returns: boolean }
      can_view_payroll: { Args: { target_school: string }; Returns: boolean }
      can_view_store: { Args: { target_school: string }; Returns: boolean }
      can_view_student: { Args: { target_student: string }; Returns: boolean }
      can_work_ticket: { Args: { target_ticket: string }; Returns: boolean }
      cancel_application_payment_attempt: {
        Args: { target_application: string }
        Returns: {
          address: string | null
          applicant_id: string | null
          applying_for_level: number | null
          assigned_reviewer_id: string | null
          class_id: string | null
          clearance_state: string
          correction_reason: string | null
          correction_requested_at: string | null
          correction_requested_by: string | null
          correction_resubmitted_at: string | null
          correction_sections: string[] | null
          created_at: string
          date_of_birth: string | null
          decided_at: string | null
          decided_by: string | null
          decision_state: string
          declaration_accepted_at: string | null
          document_links: string | null
          documents_state: string
          education_history: Json | null
          exam_results: Json | null
          final_decided_at: string | null
          final_decided_by: string | null
          final_decision_note: string | null
          first_name: string
          form_state: string
          gender: string | null
          guardian_email: string
          guardian_name: string
          guardian_phone: string | null
          guardian_relation: string | null
          id: string
          interview_state: string
          it_ticket_id: string | null
          middle_name: string | null
          next_of_kin: Json | null
          notes: string | null
          offer_expires_at: string | null
          offer_state: string
          payment_state: string
          personal_info: Json | null
          previous_school: string | null
          programme_id: string | null
          referees: Json | null
          reference: string
          registration_state: string
          review_completed_at: string | null
          review_state: string
          school_id: string
          screening_completed_at: string | null
          screening_state: string
          seq: number
          session_id: string | null
          status: Database["classroom"]["Enums"]["application_status"]
          student_account_id: string | null
          student_id: string | null
          submitted_at: string | null
          submitted_snapshot: Json | null
          surname: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_invoice: {
        Args: { reason: string; target_invoice: string }
        Returns: {
          application_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          class_id: string | null
          created_at: string
          created_by: string | null
          discount: number
          discount_reason: string | null
          discount_rule_id: string | null
          due_on: string | null
          id: string
          issued_at: string | null
          issued_by: string | null
          notes: string | null
          purpose: string
          reference: string
          school_id: string
          seq: number
          session_id: string
          status: Database["classroom"]["Enums"]["invoice_status"]
          structure_id: string | null
          student_id: string | null
          term_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_school_access_request: {
        Args: { target_slug: string }
        Returns: undefined
      }
      carry_forward_balances: { Args: { target_term: string }; Returns: Json }
      chat_overview: { Args: { target_school: string }; Returns: Json }
      child_courses: {
        Args: { target_school: string; target_student: string }
        Returns: {
          assignments_done: number
          assignments_late: number
          assignments_set: number
          course_code: string
          course_id: string
          course_title: string
          exams_sat: number
          is_current: boolean
          joined_at: string
          last_active: string
          on_time_pct: number
          posts: number
          session_id: string
          session_name: string
          teacher_id: string
          teacher_name: string
          turn_in_pct: number
        }[]
      }
      child_teachers: {
        Args: { target_school: string; target_student: string }
        Returns: {
          avatar_url: string
          courses: string
          courses_count: number
          email: string
          teacher_id: string
          teacher_name: string
          teaching_now: boolean
        }[]
      }
      claim_application: {
        Args: { target_email: string; target_reference: string }
        Returns: {
          address: string | null
          applicant_id: string | null
          applying_for_level: number | null
          assigned_reviewer_id: string | null
          class_id: string | null
          clearance_state: string
          correction_reason: string | null
          correction_requested_at: string | null
          correction_requested_by: string | null
          correction_resubmitted_at: string | null
          correction_sections: string[] | null
          created_at: string
          date_of_birth: string | null
          decided_at: string | null
          decided_by: string | null
          decision_state: string
          declaration_accepted_at: string | null
          document_links: string | null
          documents_state: string
          education_history: Json | null
          exam_results: Json | null
          final_decided_at: string | null
          final_decided_by: string | null
          final_decision_note: string | null
          first_name: string
          form_state: string
          gender: string | null
          guardian_email: string
          guardian_name: string
          guardian_phone: string | null
          guardian_relation: string | null
          id: string
          interview_state: string
          it_ticket_id: string | null
          middle_name: string | null
          next_of_kin: Json | null
          notes: string | null
          offer_expires_at: string | null
          offer_state: string
          payment_state: string
          personal_info: Json | null
          previous_school: string | null
          programme_id: string | null
          referees: Json | null
          reference: string
          registration_state: string
          review_completed_at: string | null
          review_state: string
          school_id: string
          screening_completed_at: string | null
          screening_state: string
          seq: number
          session_id: string | null
          status: Database["classroom"]["Enums"]["application_status"]
          student_account_id: string | null
          student_id: string | null
          submitted_at: string | null
          submitted_snapshot: Json | null
          surname: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      clear_gateway_secret: {
        Args: { target_gateway: string }
        Returns: undefined
      }
      clear_timetable_slot: {
        Args: {
          target_class: string
          target_day: number
          target_period: string
          target_term: string
        }
        Returns: undefined
      }
      collection_summary: {
        Args: { target_school: string; target_term?: string }
        Returns: {
          awaiting: number
          collected: number
          collection_rate: number
          debtors: number
          invoiced: number
          invoices: number
          outstanding: number
          settled: number
        }[]
      }
      confirm_subscription_payment: {
        Args: {
          paid_amount: number
          paid_at_in: string
          ref: string
          response: Json
        }
        Returns: Json
      }
      copy_timetable: {
        Args: { from_term: string; to_term: string }
        Returns: number
      }
      course_is_visible: { Args: { target_course: string }; Returns: boolean }
      create_applicant_account: {
        Args: {
          date_of_birth_in?: string
          email_in: string
          first_name_in: string
          middle_name_in?: string
          nationality_in?: string
          phone_in?: string
          surname_in: string
          target_school: string
        }
        Returns: {
          created_at: string
          date_of_birth: string | null
          email: string
          first_name: string
          id: string
          middle_name: string | null
          nationality: string | null
          phone: string | null
          school_id: string
          surname: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "applicant_accounts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_application_clearance_items: {
        Args: { target_application: string }
        Returns: {
          application_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          department_id: string
          id: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "clearance_checklists"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_application_document_items: {
        Args: { target_application: string; target_school: string }
        Returns: {
          application_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          document_id: string | null
          id: string
          requirement_id: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "applicant_documents"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_application_screening_items: {
        Args: { target_application: string; target_school: string }
        Returns: {
          application_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          is_required: boolean
          kind: string
          label: string
          position: number
          requirement_id: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "application_screening_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_attendance_device: {
        Args: { device_label?: string; target_school: string }
        Returns: {
          api_key: string
          id: string
        }[]
      }
      create_group_channel: {
        Args: {
          channel_name: string
          member_ids: string[]
          target_school: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          dm_key: string | null
          id: string
          is_private: boolean
          kind: string
          last_message_at: string
          name: string | null
          school_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_channels"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_school: {
        Args: {
          country_in?: string
          currency_in?: string
          owner_email?: string
          school_name: string
          school_slug: string
          timezone_in?: string
        }
        Returns: {
          address: string | null
          admission_letter_closing: string | null
          admission_letter_enrolled_intro: string | null
          admission_letter_offer_intro: string | null
          ai_token_limit: number
          allow_self_signup: boolean
          archived_at: string | null
          country: string | null
          created_at: string
          currency: string
          disabled_modules: string[]
          email: string | null
          id: string
          idle_lockout_enabled: boolean
          idle_lockout_minutes: number
          is_active: boolean
          logo_url: string | null
          name: string
          paid_until: string | null
          phone: string | null
          plan: string
          signatory_name: string | null
          signatory_title: string | null
          signature_url: string | null
          slug: string
          theme_color: string | null
          timezone: string
          trial_ends_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "schools"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_ticket: {
        Args: {
          description_in: string
          group_id_in?: string
          priority_in?: string
          requester_email_in?: string
          requester_name_in?: string
          subject_in: string
          target_school: string
        }
        Returns: {
          assigned_to: string | null
          channel: string
          closed_at: string | null
          created_at: string
          description: string
          description_format: string
          first_response_at: string | null
          group_id: string | null
          id: string
          mailbox_id: string | null
          number: number
          origin_message_id: string | null
          priority: string
          requester_email: string | null
          requester_id: string | null
          requester_name: string | null
          resolved_at: string | null
          school_id: string
          status: string
          subject: string
          tags: string[]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_ticket_mailbox: {
        Args: {
          address_in: string
          display_name_in: string
          imap_host_in: string
          imap_port_in: number
          imap_security_in: string
          label_in: string
          password_in: string
          provider_in: string
          smtp_host_in: string
          smtp_port_in: number
          smtp_security_in: string
          target_school: string
          username_in: string
        }
        Returns: {
          address: string
          created_at: string
          display_name: string | null
          id: string
          imap_host: string | null
          imap_port: number | null
          imap_security: string | null
          is_active: boolean
          label: string
          last_poll_at: string | null
          last_poll_error: string | null
          last_poll_status: string | null
          oauth_connected_email: string | null
          oauth_tenant_id: string | null
          oauth_vault_id: string | null
          provider: string
          school_id: string
          secret_vault_id: string | null
          smtp_host: string | null
          smtp_port: number | null
          smtp_security: string | null
          updated_at: string
          username: string | null
        }
        SetofOptions: {
          from: "*"
          to: "ticket_mailboxes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      debtors: {
        Args: { target_school: string; target_term?: string }
        Returns: {
          balance: number
          class_name: string
          guardians: string
          invoices: number
          oldest_due: string
          paid: number
          payable: number
          student: string
          student_id: string
        }[]
      }
      decide_application: {
        Args: {
          conditions_in?: string
          current_school: string
          new_status: Database["classroom"]["Enums"]["application_status"]
          note?: string
          offer_expires?: string
          target_application: string
        }
        Returns: {
          address: string | null
          applicant_id: string | null
          applying_for_level: number | null
          assigned_reviewer_id: string | null
          class_id: string | null
          clearance_state: string
          correction_reason: string | null
          correction_requested_at: string | null
          correction_requested_by: string | null
          correction_resubmitted_at: string | null
          correction_sections: string[] | null
          created_at: string
          date_of_birth: string | null
          decided_at: string | null
          decided_by: string | null
          decision_state: string
          declaration_accepted_at: string | null
          document_links: string | null
          documents_state: string
          education_history: Json | null
          exam_results: Json | null
          final_decided_at: string | null
          final_decided_by: string | null
          final_decision_note: string | null
          first_name: string
          form_state: string
          gender: string | null
          guardian_email: string
          guardian_name: string
          guardian_phone: string | null
          guardian_relation: string | null
          id: string
          interview_state: string
          it_ticket_id: string | null
          middle_name: string | null
          next_of_kin: Json | null
          notes: string | null
          offer_expires_at: string | null
          offer_state: string
          payment_state: string
          personal_info: Json | null
          previous_school: string | null
          programme_id: string | null
          referees: Json | null
          reference: string
          registration_state: string
          review_completed_at: string | null
          review_state: string
          school_id: string
          screening_completed_at: string | null
          screening_state: string
          seq: number
          session_id: string | null
          status: Database["classroom"]["Enums"]["application_status"]
          student_account_id: string | null
          student_id: string | null
          submitted_at: string | null
          submitted_snapshot: Json | null
          surname: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      decide_enrollment: {
        Args: { approve: boolean; target_course: string; target_user: string }
        Returns: {
          course_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          message: string | null
          requested_at: string
          status: Database["classroom"]["Enums"]["enrollment_status"]
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "enrollments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      decide_school_access: {
        Args: {
          approve: boolean
          hours_in: number
          note?: string
          target_request: string
        }
        Returns: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decline_note: string | null
          expires_at: string | null
          hours: number | null
          id: string
          reason: string
          school_id: string
          status: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "platform_access_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      declare_admissions_payment: {
        Args: {
          amount: number
          method?: Database["classroom"]["Enums"]["payment_method"]
          note?: string
          paid_on?: string
          proof_path?: string
          reference?: string
          target_invoice: string
        }
        Returns: {
          amount: number
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          gateway: string | null
          gateway_fee: number | null
          gateway_mode: string | null
          gateway_ref: string | null
          id: string
          invoice_id: string
          method: Database["classroom"]["Enums"]["payment_method"]
          note: string | null
          paid_on: string
          proof_path: string | null
          reference: string | null
          school_id: string
          status: Database["classroom"]["Enums"]["payment_status"]
          submitted_at: string
          submitted_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      decline_offer: {
        Args: { reason_in?: string; target_offer: string }
        Returns: {
          address: string | null
          applicant_id: string | null
          applying_for_level: number | null
          assigned_reviewer_id: string | null
          class_id: string | null
          clearance_state: string
          correction_reason: string | null
          correction_requested_at: string | null
          correction_requested_by: string | null
          correction_resubmitted_at: string | null
          correction_sections: string[] | null
          created_at: string
          date_of_birth: string | null
          decided_at: string | null
          decided_by: string | null
          decision_state: string
          declaration_accepted_at: string | null
          document_links: string | null
          documents_state: string
          education_history: Json | null
          exam_results: Json | null
          final_decided_at: string | null
          final_decided_by: string | null
          final_decision_note: string | null
          first_name: string
          form_state: string
          gender: string | null
          guardian_email: string
          guardian_name: string
          guardian_phone: string | null
          guardian_relation: string | null
          id: string
          interview_state: string
          it_ticket_id: string | null
          middle_name: string | null
          next_of_kin: Json | null
          notes: string | null
          offer_expires_at: string | null
          offer_state: string
          payment_state: string
          personal_info: Json | null
          previous_school: string | null
          programme_id: string | null
          referees: Json | null
          reference: string
          registration_state: string
          review_completed_at: string | null
          review_state: string
          school_id: string
          screening_completed_at: string | null
          screening_state: string
          seq: number
          session_id: string | null
          status: Database["classroom"]["Enums"]["application_status"]
          student_account_id: string | null
          student_id: string | null
          submitted_at: string | null
          submitted_snapshot: Json | null
          surname: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_ticket_mailbox: {
        Args: { target_mailbox: string; target_school: string }
        Returns: undefined
      }
      discount_amount: {
        Args: { target_invoice: string; target_rule: string }
        Returns: number
      }
      due_subscription_reminders: {
        Args: never
        Returns: {
          amount: number
          currency: string
          days_before: number
          days_left: number
          ends_on: string
          kind: string
          plan_name: string
          recipients: Json
          school_id: string
          school_name: string
          slug: string
        }[]
      }
      effective_admission_config: {
        Args: { target_school: string; target_session: string }
        Returns: Json
      }
      email_change_blocker: {
        Args: { target_school: string; target_user: string }
        Returns: string
      }
      end_school_access: {
        Args: { target_school: string; target_user: string }
        Returns: undefined
      }
      ensure_it_group: { Args: { target_school: string }; Returns: string }
      expire_school_access: { Args: never; Returns: number }
      family_accounts_request: {
        Args: { target_ticket: string }
        Returns: Json
      }
      finish_family_accounts: {
        Args: {
          actor: string
          emailed_to: string
          parent_new: boolean
          parent_user: string
          student_user: string
          student_username: string
          target_application: string
          target_ticket: string
        }
        Returns: undefined
      }
      forget_push_subscription: {
        Args: { endpoint_in: string }
        Returns: undefined
      }
      format_money: {
        Args: { amount: number; currency: string }
        Returns: string
      }
      gateway_secret_for_webhook: {
        Args: { target_gateway: string }
        Returns: {
          mode: string
          provider: string
          public_config: Json
          school_id: string
          secrets: Json
        }[]
      }
      gateway_settings_for_payer: {
        Args: { target_invoice: string }
        Returns: {
          gateway_id: string
          mode: string
          provider: string
          public_config: Json
          require_confirmation: boolean
        }[]
      }
      generate_due_reminders: { Args: never; Returns: number }
      get_chat_push_context: { Args: { target_message: string }; Returns: Json }
      get_gateway_secret: { Args: { target_gateway: string }; Returns: Json }
      get_mail_push_context: { Args: { target_message: string }; Returns: Json }
      get_mailbox_secret: {
        Args: { target_mailbox: string; which: string }
        Returns: string
      }
      get_notification_push_context: {
        Args: { target_notification: string }
        Returns: Json
      }
      get_payment_notification_context: {
        Args: { target_payment: string }
        Returns: {
          amount: number
          class_name: string
          currency: string
          invoice_reference: string
          mailbox_id: string
          method: Database["classroom"]["Enums"]["payment_method"]
          paid_on: string
          payment_reference: string
          recipients: string[]
          school_id: string
          school_name: string
          student_name: string
        }[]
      }
      get_school_for_mail: {
        Args: { target_school: string }
        Returns: {
          admission_letter_closing: string
          admission_letter_enrolled_intro: string
          admission_letter_offer_intro: string
          id: string
          logo_url: string
          name: string
          signatory_name: string
          signatory_title: string
          slug: string
          theme_color: string
        }[]
      }
      get_school_mailbox: {
        Args: { target_school: string }
        Returns: {
          address: string
          created_at: string
          display_name: string | null
          id: string
          imap_host: string | null
          imap_port: number | null
          imap_security: string | null
          is_active: boolean
          label: string
          last_poll_at: string | null
          last_poll_error: string | null
          last_poll_status: string | null
          oauth_connected_email: string | null
          oauth_tenant_id: string | null
          oauth_vault_id: string | null
          provider: string
          school_id: string
          secret_vault_id: string | null
          smtp_host: string | null
          smtp_port: number | null
          smtp_security: string | null
          updated_at: string
          username: string | null
        }
        SetofOptions: {
          from: "*"
          to: "ticket_mailboxes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_ticket_mailbox: {
        Args: { target_mailbox: string }
        Returns: {
          address: string
          created_at: string
          display_name: string | null
          id: string
          imap_host: string | null
          imap_port: number | null
          imap_security: string | null
          is_active: boolean
          label: string
          last_poll_at: string | null
          last_poll_error: string | null
          last_poll_status: string | null
          oauth_connected_email: string | null
          oauth_tenant_id: string | null
          oauth_vault_id: string | null
          provider: string
          school_id: string
          secret_vault_id: string | null
          smtp_host: string | null
          smtp_port: number | null
          smtp_security: string | null
          updated_at: string
          username: string | null
        }
        SetofOptions: {
          from: "*"
          to: "ticket_mailboxes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      grade_for: { Args: { pct: number }; Returns: string }
      has_role_in: {
        Args: {
          roles: Database["classroom"]["Enums"]["member_role"][]
          target_school: string
        }
        Returns: boolean
      }
      ingest_inbound_ticket_email: {
        Args: {
          body_format_in?: string
          body_in: string
          from_email_in: string
          from_name_in: string
          in_reply_to_in: string
          message_id_in: string
          references_in: string[]
          subject_in: string
          target_mailbox: string
        }
        Returns: string
      }
      invoice_applicant_name: {
        Args: { target_invoice: string }
        Returns: string
      }
      is_active_school: { Args: { target_school: string }; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_allowed_reaction: { Args: { symbol: string }; Returns: boolean }
      is_applicant_for: {
        Args: { target_application: string }
        Returns: boolean
      }
      is_chat_channel_admin: {
        Args: { target_channel: string }
        Returns: boolean
      }
      is_chat_member: { Args: { target_channel: string }; Returns: boolean }
      is_chat_member_of_message: {
        Args: { target_message: string }
        Returns: boolean
      }
      is_enrolled_in: { Args: { target_course: string }; Returns: boolean }
      is_guardian_of: { Args: { target_student: string }; Returns: boolean }
      is_member_of: { Args: { target_school: string }; Returns: boolean }
      is_my_family_sheet: { Args: { target_sheet: string }; Returns: boolean }
      is_my_invoice: { Args: { target_invoice: string }; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      is_school_admin: { Args: { target_school: string }; Returns: boolean }
      is_school_approver: { Args: { target_school: string }; Returns: boolean }
      is_school_staff: { Args: { target_school: string }; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      is_ticket_staff: { Args: { target_school: string }; Returns: boolean }
      issue_invoice: {
        Args: { target_invoice: string }
        Returns: {
          application_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          class_id: string | null
          created_at: string
          created_by: string | null
          discount: number
          discount_reason: string | null
          discount_rule_id: string | null
          due_on: string | null
          id: string
          issued_at: string | null
          issued_by: string | null
          notes: string | null
          purpose: string
          reference: string
          school_id: string
          seq: number
          session_id: string
          status: Database["classroom"]["Enums"]["invoice_status"]
          structure_id: string | null
          student_id: string | null
          term_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      join_school: {
        Args: { target_slug: string }
        Returns: {
          access_expires_at: string | null
          created_at: string
          granted_by: string | null
          granted_via: string | null
          id: string
          is_active: boolean
          job_title: string | null
          manager_id: string | null
          role: Database["classroom"]["Enums"]["member_role"]
          school_id: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "school_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      last_ticket_email_message_id: {
        Args: { target_ticket: string }
        Returns: string
      }
      list_active_ticket_mailboxes: {
        Args: { provider_filter: string }
        Returns: {
          address: string
          created_at: string
          display_name: string | null
          id: string
          imap_host: string | null
          imap_port: number | null
          imap_security: string | null
          is_active: boolean
          label: string
          last_poll_at: string | null
          last_poll_error: string | null
          last_poll_status: string | null
          oauth_connected_email: string | null
          oauth_tenant_id: string | null
          oauth_vault_id: string | null
          provider: string
          school_id: string
          secret_vault_id: string | null
          smtp_host: string | null
          smtp_port: number | null
          smtp_security: string | null
          updated_at: string
          username: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "ticket_mailboxes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      mail_access: {
        Args: { target_mailbox: string; who: string }
        Returns: string
      }
      mail_address_taken: {
        Args: { addr: string; except_list?: string; except_mailbox?: string }
        Returns: boolean
      }
      mail_admin_box: {
        Args: { target_mailbox: string }
        Returns: {
          address: string
          autoreply_enabled: boolean
          autoreply_end: string | null
          autoreply_html: string
          autoreply_outside: boolean
          autoreply_start: string | null
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          kind: string
          notify_opens: boolean
          previous_addresses: string[]
          push_new_mail: boolean
          quota_bytes: number
          school_id: string
          signature_html: string
          undo_seconds: number
          updated_at: string
          used_bytes: number
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "mail_mailboxes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mail_admin_convert_to_shared: {
        Args: { members: Json; target_mailbox: string }
        Returns: {
          address: string
          autoreply_enabled: boolean
          autoreply_end: string | null
          autoreply_html: string
          autoreply_outside: boolean
          autoreply_start: string | null
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          kind: string
          notify_opens: boolean
          previous_addresses: string[]
          push_new_mail: boolean
          quota_bytes: number
          school_id: string
          signature_html: string
          undo_seconds: number
          updated_at: string
          used_bytes: number
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "mail_mailboxes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mail_admin_create_all: {
        Args: { target_school: string }
        Returns: number
      }
      mail_admin_delete_list: {
        Args: { target_list: string }
        Returns: undefined
      }
      mail_admin_lists: {
        Args: { target_school: string }
        Returns: {
          address: string
          allow_outside: boolean
          id: string
          members: Json
          name: string
        }[]
      }
      mail_admin_move_to_domain: {
        Args: { target_school: string }
        Returns: number
      }
      mail_admin_people: {
        Args: { target_school: string }
        Returns: {
          address: string
          aliases: string[]
          is_active: boolean
          job_title: string
          mailbox_id: string
          name: string
          quota_bytes: number
          role: string
          used_bytes: number
          user_id: string
        }[]
      }
      mail_admin_safety: {
        Args: { patch: Json; target_school: string }
        Returns: Json
      }
      mail_admin_save_list: {
        Args: {
          address_in: string
          allow_outside_in: boolean
          member_mailboxes: string[]
          name_in: string
          target_list: string
          target_school: string
        }
        Returns: string
      }
      mail_admin_save_shared: {
        Args: {
          address_in: string
          members: Json
          name_in: string
          target_mailbox: string
          target_school: string
        }
        Returns: {
          address: string
          autoreply_enabled: boolean
          autoreply_end: string | null
          autoreply_html: string
          autoreply_outside: boolean
          autoreply_start: string | null
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          kind: string
          notify_opens: boolean
          previous_addresses: string[]
          push_new_mail: boolean
          quota_bytes: number
          school_id: string
          signature_html: string
          undo_seconds: number
          updated_at: string
          used_bytes: number
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "mail_mailboxes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mail_admin_set_active: {
        Args: { active: boolean; target_mailbox: string }
        Returns: {
          address: string
          autoreply_enabled: boolean
          autoreply_end: string | null
          autoreply_html: string
          autoreply_outside: boolean
          autoreply_start: string | null
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          kind: string
          notify_opens: boolean
          previous_addresses: string[]
          push_new_mail: boolean
          quota_bytes: number
          school_id: string
          signature_html: string
          undo_seconds: number
          updated_at: string
          used_bytes: number
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "mail_mailboxes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mail_admin_set_address: {
        Args: { new_address: string; target_mailbox: string }
        Returns: {
          address: string
          autoreply_enabled: boolean
          autoreply_end: string | null
          autoreply_html: string
          autoreply_outside: boolean
          autoreply_start: string | null
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          kind: string
          notify_opens: boolean
          previous_addresses: string[]
          push_new_mail: boolean
          quota_bytes: number
          school_id: string
          signature_html: string
          undo_seconds: number
          updated_at: string
          used_bytes: number
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "mail_mailboxes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mail_admin_set_aliases: {
        Args: { aliases: string[]; target_mailbox: string }
        Returns: {
          address: string
          autoreply_enabled: boolean
          autoreply_end: string | null
          autoreply_html: string
          autoreply_outside: boolean
          autoreply_start: string | null
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          kind: string
          notify_opens: boolean
          previous_addresses: string[]
          push_new_mail: boolean
          quota_bytes: number
          school_id: string
          signature_html: string
          undo_seconds: number
          updated_at: string
          used_bytes: number
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "mail_mailboxes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mail_admin_set_members: {
        Args: { members: Json; target_mailbox: string }
        Returns: undefined
      }
      mail_admin_set_quota: {
        Args: { gigabytes: number; target_mailbox: string }
        Returns: {
          address: string
          autoreply_enabled: boolean
          autoreply_end: string | null
          autoreply_html: string
          autoreply_outside: boolean
          autoreply_start: string | null
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          kind: string
          notify_opens: boolean
          previous_addresses: string[]
          push_new_mail: boolean
          quota_bytes: number
          school_id: string
          signature_html: string
          undo_seconds: number
          updated_at: string
          used_bytes: number
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "mail_mailboxes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mail_admin_shared: {
        Args: { target_school: string }
        Returns: {
          address: string
          aliases: string[]
          id: string
          is_active: boolean
          members: Json
          name: string
          quota_bytes: number
          used_bytes: number
        }[]
      }
      mail_autoreply: {
        Args: {
          in_reply_to_in: string
          outside: boolean
          sender_in: string
          sender_name_in: string
          subject_in: string
          target_box: string
          thread_in: string
        }
        Returns: undefined
      }
      mail_can_import: { Args: { target_mailbox: string }; Returns: boolean }
      mail_check_address: {
        Args: { addr: string; target_school: string }
        Returns: string
      }
      mail_check_limits: {
        Args: {
          box: Database["classroom"]["Tables"]["mail_mailboxes"]["Row"]
          wanted: number
        }
        Returns: undefined
      }
      mail_create_mailbox: {
        Args: { target_school: string; target_user: string }
        Returns: {
          address: string
          autoreply_enabled: boolean
          autoreply_end: string | null
          autoreply_html: string
          autoreply_outside: boolean
          autoreply_start: string | null
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          kind: string
          notify_opens: boolean
          previous_addresses: string[]
          push_new_mail: boolean
          quota_bytes: number
          school_id: string
          signature_html: string
          undo_seconds: number
          updated_at: string
          used_bytes: number
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "mail_mailboxes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mail_delete_mailbox: {
        Args: { target_mailbox: string }
        Returns: string[]
      }
      mail_delete_mailbox_by: {
        Args: { actor: string; target_mailbox: string }
        Returns: string[]
      }
      mail_delivery_event: {
        Args: {
          detail_in: string
          event_in: string
          provider_id_in: string
          recipients_in?: string[]
          target_school: string
        }
        Returns: number
      }
      mail_directory: {
        Args: { target_school: string }
        Returns: {
          address: string
          avatar_url: string
          job_title: string
          name: string
        }[]
      }
      mail_domain: { Args: { target_school: string }; Returns: string }
      mail_domain_taken: {
        Args: { domain_in: string; target_school: string }
        Returns: boolean
      }
      mail_group_members: {
        Args: { sender_box: string; token: string }
        Returns: {
          address: string
          name: string
        }[]
      }
      mail_groups: {
        Args: { target_school: string }
        Returns: {
          address: string
          kind: string
          members: number
          name: string
        }[]
      }
      mail_import_append: {
        Args: { path_in: string; size_in: number; target_import: string }
        Returns: undefined
      }
      mail_import_claim: { Args: never; Returns: Json }
      mail_import_control: {
        Args: { action_in: string; target_import: string }
        Returns: {
          bytes: number
          created_at: string
          created_by: string | null
          cursor: Json
          failed: number
          file_paths: string[]
          finished_at: string | null
          found: number
          id: string
          imap_host: string | null
          imap_port: number | null
          imap_security: string | null
          imap_username: string | null
          imported: number
          label: string
          last_error: string | null
          lease_until: string | null
          mailbox_id: string
          school_id: string
          secret_vault_id: string | null
          since: string | null
          skipped: number
          source: string
          source_user: string | null
          started_at: string | null
          status: string
          target_folder: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "mail_imports"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mail_import_create: {
        Args: {
          actor: string
          fields: Json
          password_in?: string
          target_mailbox: string
        }
        Returns: {
          bytes: number
          created_at: string
          created_by: string | null
          cursor: Json
          failed: number
          file_paths: string[]
          finished_at: string | null
          found: number
          id: string
          imap_host: string | null
          imap_port: number | null
          imap_security: string | null
          imap_username: string | null
          imported: number
          label: string
          last_error: string | null
          lease_until: string | null
          mailbox_id: string
          school_id: string
          secret_vault_id: string | null
          since: string | null
          skipped: number
          source: string
          source_user: string | null
          started_at: string | null
          status: string
          target_folder: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "mail_imports"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mail_import_finish: {
        Args: { target_import: string }
        Returns: undefined
      }
      mail_import_forget: { Args: never; Returns: number }
      mail_import_message: {
        Args: {
          envelope_in: string
          files?: Json
          folder_in: string
          key_in: string
          msg: Json
          target_mailbox: string
        }
        Returns: string
      }
      mail_import_progress: {
        Args: {
          add: Json
          cursor_in: Json
          error_in?: string
          status_in: string
          target_import: string
        }
        Returns: undefined
      }
      mail_import_seen: {
        Args: { keys: string[]; target_mailbox: string }
        Returns: string[]
      }
      mail_inbound_retry_add: {
        Args: { email_id_in: string; error_in: string; target_school: string }
        Returns: undefined
      }
      mail_inbound_retry_done: {
        Args: { email_id_in: string; target_school: string }
        Returns: undefined
      }
      mail_inbound_retry_due: {
        Args: never
        Returns: {
          email_id: string
          school_id: string
        }[]
      }
      mail_inbound_seen: {
        Args: { inbound_id_in: string; target_school: string }
        Returns: boolean
      }
      mail_inbound_targets: {
        Args: { addresses: string[]; size_in: number; target_school: string }
        Returns: {
          address: string
          mailbox_id: string
          outcome: string
        }[]
      }
      mail_junk_verdict: {
        Args: { msg: Json; target_box: string }
        Returns: Json
      }
      mail_kick: { Args: { target_message?: string }; Returns: undefined }
      mail_limit_alert: { Args: { target_mailbox: string }; Returns: undefined }
      mail_mark_sender: {
        Args: { kind_in: string; sender: string; target_box: string }
        Returns: undefined
      }
      mail_message_status: { Args: { target_message: string }; Returns: Json }
      mail_microsoft_tenant: {
        Args: { target_school: string }
        Returns: string
      }
      mail_move_draft: {
        Args: { target_draft: string; target_mailbox: string }
        Returns: undefined
      }
      mail_my_mailbox: {
        Args: { target_school: string }
        Returns: {
          address: string
          autoreply_enabled: boolean
          autoreply_end: string | null
          autoreply_html: string
          autoreply_outside: boolean
          autoreply_start: string | null
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          kind: string
          notify_opens: boolean
          previous_addresses: string[]
          push_new_mail: boolean
          quota_bytes: number
          school_id: string
          signature_html: string
          undo_seconds: number
          updated_at: string
          used_bytes: number
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "mail_mailboxes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mail_my_mailboxes: {
        Args: { target_school: string }
        Returns: {
          access: string
          address: string
          display_name: string
          id: string
          is_active: boolean
          kind: string
          unread: number
        }[]
      }
      mail_notice: {
        Args: { html_in: string; subject_in: string; target_mailbox: string }
        Returns: undefined
      }
      mail_open_picture: { Args: { token_in: string }; Returns: boolean }
      mail_outbound_claim: {
        Args: { max_messages?: number; only_message?: string }
        Returns: Json
      }
      mail_outbound_release: {
        Args: { detail_in?: string; recipient_ids: string[]; retry_at?: string }
        Returns: undefined
      }
      mail_outbound_result: {
        Args: {
          error_in: string
          ok: boolean
          permanent: boolean
          provider_id_in: string
          recipient_ids: string[]
        }
        Returns: undefined
      }
      mail_outbound_settle: {
        Args: { target_message: string }
        Returns: undefined
      }
      mail_outbound_share_token: {
        Args: { recipient_ids: string[] }
        Returns: string
      }
      mail_platform_dns_done: {
        Args: { target_school: string }
        Returns: undefined
      }
      mail_recall: { Args: { target_message: string }; Returns: Json }
      mail_receive: {
        Args: {
          envelope_in: string
          files?: Json
          inbound_id_in: string
          mailbox_ids: string[]
          msg: Json
          target_school: string
        }
        Returns: number
      }
      mail_record_open: {
        Args: { recipient_in: string; sender_copy: string; via_in: string }
        Returns: boolean
      }
      mail_report_phishing: { Args: { target_message: string }; Returns: Json }
      mail_retention_run: { Args: never; Returns: Json }
      mail_rule_forward: {
        Args: {
          src: Database["classroom"]["Tables"]["mail_messages"]["Row"]
          target: string
        }
        Returns: undefined
      }
      mail_schedule: {
        Args: { at_in: string; target_draft: string }
        Returns: undefined
      }
      mail_school_slug: { Args: { target_school: string }; Returns: string }
      mail_send: { Args: { target_draft: string }; Returns: Json }
      mail_send_as: {
        Args: { actor: string; target_draft: string }
        Returns: Json
      }
      mail_send_due: { Args: never; Returns: number }
      mail_sender_standing: {
        Args: { sender: string; target_box: string }
        Returns: string
      }
      mail_set_microsoft_tenant: {
        Args: { actor?: string; target_school: string; tenant_in: string }
        Returns: undefined
      }
      mail_settings_clear: {
        Args: { actor?: string; target_school: string }
        Returns: undefined
      }
      mail_settings_get: { Args: { target_school: string }; Returns: Json }
      mail_settings_receiving: {
        Args: {
          actor?: string
          enabled_in: boolean
          status_in: string
          target_school: string
        }
        Returns: undefined
      }
      mail_settings_save: {
        Args: {
          actor?: string
          api_key_in?: string
          dns_records_in: Json
          domain_in: string
          domain_status_in: string
          last_error_in?: string
          region_in: string
          resend_domain_id_in: string
          target_school: string
          webhook_id_in?: string
          webhook_secret_in?: string
        }
        Returns: undefined
      }
      mail_settings_secrets: {
        Args: { target_school: string }
        Returns: {
          api_key: string
          domain: string
          domain_status: string
          region: string
          resend_domain_id: string
          sending_enabled: boolean
          webhook_id: string
          webhook_secret: string
        }[]
      }
      mail_snippet: { Args: { html: string }; Returns: string }
      mail_unread: { Args: { target_school: string }; Returns: number }
      mark_attempt: {
        Args: { forced?: boolean; target_attempt: string }
        Returns: {
          auto_score: number | null
          auto_submitted: boolean
          disqualified: boolean
          disqualified_reason: string | null
          exam_id: string
          graded_at: string | null
          id: string
          max_score: number | null
          started_at: string
          submitted_at: string | null
          submitted_late: boolean
          total_score: number | null
          user_id: string
          violations: number
        }
        SetofOptions: {
          from: "*"
          to: "exam_attempts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_exam_answer: {
        Args: { points: number; target_answer: string; target_school: string }
        Returns: undefined
      }
      mark_module_seen: {
        Args: { target_module: string; target_school: string }
        Returns: undefined
      }
      mark_subscription_payment: {
        Args: { ref: string; response: Json; status_in: string }
        Returns: undefined
      }
      markable_classes: {
        Args: { target_school: string }
        Returns: {
          created_at: string
          form_teacher_id: string | null
          id: string
          level_year: number
          name: string
          school_id: string
          session_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "classes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      may_touch_payment_proof: {
        Args: { path_invoice: string }
        Returns: boolean
      }
      may_view_payment_proof: {
        Args: { path_invoice: string }
        Returns: boolean
      }
      module_access: {
        Args: { target_module: string; target_school: string }
        Returns: string
      }
      module_attention: { Args: { target_school: string }; Returns: Json }
      module_level: {
        Args: {
          role_list: Database["classroom"]["Enums"]["member_role"][]
          target_module: string
          target_school: string
        }
        Returns: string
      }
      module_override: {
        Args: { target_module: string; target_school: string }
        Returns: string
      }
      module_seen_at: {
        Args: { target_module: string; target_school: string }
        Returns: string
      }
      my_application_documents: {
        Args: { target_application: string }
        Returns: Json
      }
      my_application_letter: {
        Args: { target_application: string }
        Returns: Json
      }
      my_application_screening: {
        Args: { target_application: string }
        Returns: Json
      }
      my_applications: {
        Args: { target_school: string }
        Returns: {
          address: string | null
          applicant_id: string | null
          applying_for_level: number | null
          assigned_reviewer_id: string | null
          class_id: string | null
          clearance_state: string
          correction_reason: string | null
          correction_requested_at: string | null
          correction_requested_by: string | null
          correction_resubmitted_at: string | null
          correction_sections: string[] | null
          created_at: string
          date_of_birth: string | null
          decided_at: string | null
          decided_by: string | null
          decision_state: string
          declaration_accepted_at: string | null
          document_links: string | null
          documents_state: string
          education_history: Json | null
          exam_results: Json | null
          final_decided_at: string | null
          final_decided_by: string | null
          final_decision_note: string | null
          first_name: string
          form_state: string
          gender: string | null
          guardian_email: string
          guardian_name: string
          guardian_phone: string | null
          guardian_relation: string | null
          id: string
          interview_state: string
          it_ticket_id: string | null
          middle_name: string | null
          next_of_kin: Json | null
          notes: string | null
          offer_expires_at: string | null
          offer_state: string
          payment_state: string
          personal_info: Json | null
          previous_school: string | null
          programme_id: string | null
          referees: Json | null
          reference: string
          registration_state: string
          review_completed_at: string | null
          review_state: string
          school_id: string
          screening_completed_at: string | null
          screening_state: string
          seq: number
          session_id: string | null
          status: Database["classroom"]["Enums"]["application_status"]
          student_account_id: string | null
          student_id: string | null
          submitted_at: string | null
          submitted_snapshot: Json | null
          surname: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "applications"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      my_payslips: { Args: never; Returns: Json }
      my_role: {
        Args: never
        Returns: Database["classroom"]["Enums"]["user_role"]
      }
      my_school_ids: { Args: never; Returns: string[] }
      my_school_subscription: { Args: { target_school: string }; Returns: Json }
      my_teaching: {
        Args: { target_school: string }
        Returns: {
          class_id: string
          class_name: string
          class_subject_id: string
          level_year: number
          students: number
          subject_name: string
        }[]
      }
      next_invoice_reference: {
        Args: { target_school: string; target_term: string }
        Returns: {
          reference: string
          seq: number
        }[]
      }
      next_ticket_number: { Args: { target_school: string }; Returns: number }
      notice_is_for_me: {
        Args: {
          audience: Database["classroom"]["Enums"]["notice_audience"]
          target_school: string
        }
        Returns: boolean
      }
      notice_recipients: {
        Args: { target_notice: string }
        Returns: {
          email: string
        }[]
      }
      notify_course: {
        Args: {
          body: string
          exclude_user?: string
          kind: string
          link: string
          target_course: string
          title: string
        }
        Returns: undefined
      }
      open_dm: {
        Args: { other_user: string; target_school: string }
        Returns: {
          created_at: string
          created_by: string | null
          dm_key: string | null
          id: string
          is_private: boolean
          kind: string
          last_message_at: string
          name: string | null
          school_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "chat_channels"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      open_result_sheet: {
        Args: {
          ca_max?: number
          exam_max?: number
          target_course: string
          target_term: string
        }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          ca_max: number
          course_id: string
          created_at: string
          created_by: string | null
          exam_max: number
          id: string
          released_at: string | null
          released_by: string | null
          school_id: string
          status: Database["classroom"]["Enums"]["result_status"]
          submitted_at: string | null
          submitted_by: string | null
          term_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "result_sheets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      owns_mailbox: { Args: { target_mailbox: string }; Returns: boolean }
      password_changed: { Args: never; Returns: undefined }
      pay_application_fee_initiated: {
        Args: { target_application: string }
        Returns: {
          address: string | null
          applicant_id: string | null
          applying_for_level: number | null
          assigned_reviewer_id: string | null
          class_id: string | null
          clearance_state: string
          correction_reason: string | null
          correction_requested_at: string | null
          correction_requested_by: string | null
          correction_resubmitted_at: string | null
          correction_sections: string[] | null
          created_at: string
          date_of_birth: string | null
          decided_at: string | null
          decided_by: string | null
          decision_state: string
          declaration_accepted_at: string | null
          document_links: string | null
          documents_state: string
          education_history: Json | null
          exam_results: Json | null
          final_decided_at: string | null
          final_decided_by: string | null
          final_decision_note: string | null
          first_name: string
          form_state: string
          gender: string | null
          guardian_email: string
          guardian_name: string
          guardian_phone: string | null
          guardian_relation: string | null
          id: string
          interview_state: string
          it_ticket_id: string | null
          middle_name: string | null
          next_of_kin: Json | null
          notes: string | null
          offer_expires_at: string | null
          offer_state: string
          payment_state: string
          personal_info: Json | null
          previous_school: string | null
          programme_id: string | null
          referees: Json | null
          reference: string
          registration_state: string
          review_completed_at: string | null
          review_state: string
          school_id: string
          screening_completed_at: string | null
          screening_state: string
          seq: number
          session_id: string | null
          status: Database["classroom"]["Enums"]["application_status"]
          student_account_id: string | null
          student_id: string | null
          submitted_at: string | null
          submitted_snapshot: Json | null
          surname: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      payable_now: {
        Args: { target_invoice: string }
        Returns: {
          balance: number
          currency: string
          invoice_id: string
          payer_email: string
          reference: string
          school_id: string
          school_name: string
        }[]
      }
      payroll_annual_tax: {
        Args: { bands: Json; chargeable: number }
        Returns: number
      }
      payroll_approve: {
        Args: { target_run: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          id: string
          note: string | null
          paid_by: string | null
          paid_on: string | null
          period: string
          prepared_at: string
          prepared_by: string | null
          returned_at: string | null
          returned_note: string | null
          school_id: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payroll_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      payroll_approver_label: {
        Args: { target_school: string }
        Returns: string
      }
      payroll_compute: {
        Args: { period_in: string; target_staff: string }
        Returns: Json
      }
      payroll_confirm_bands: {
        Args: { target_school: string }
        Returns: undefined
      }
      payroll_delete_draft: { Args: { target_run: string }; Returns: undefined }
      payroll_mark_paid: {
        Args: { paid_on_in: string; target_run: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          id: string
          note: string | null
          paid_by: string | null
          paid_on: string | null
          period: string
          prepared_at: string
          prepared_by: string | null
          returned_at: string | null
          returned_note: string | null
          school_id: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payroll_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      payroll_prepare: {
        Args: { period_in: string; target_school: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          id: string
          note: string | null
          paid_by: string | null
          paid_on: string | null
          period: string
          prepared_at: string
          prepared_by: string | null
          returned_at: string | null
          returned_note: string | null
          school_id: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payroll_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      payroll_recall: {
        Args: { target_run: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          id: string
          note: string | null
          paid_by: string | null
          paid_on: string | null
          period: string
          prepared_at: string
          prepared_by: string | null
          returned_at: string | null
          returned_note: string | null
          school_id: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payroll_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      payroll_refresh_run: {
        Args: { target_run: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          id: string
          note: string | null
          paid_by: string | null
          paid_on: string | null
          period: string
          prepared_at: string
          prepared_by: string | null
          returned_at: string | null
          returned_note: string | null
          school_id: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payroll_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      payroll_return: {
        Args: { reason: string; target_run: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          id: string
          note: string | null
          paid_by: string | null
          paid_on: string | null
          period: string
          prepared_at: string
          prepared_by: string | null
          returned_at: string | null
          returned_note: string | null
          school_id: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payroll_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      payroll_run_released: { Args: { target_run: string }; Returns: boolean }
      payroll_setup: {
        Args: { target_school: string }
        Returns: {
          approver_roles: Database["classroom"]["Enums"]["member_role"][]
          bands_confirmed_at: string | null
          bands_confirmed_by: string | null
          created_at: string
          fund_label: string
          nhf_percent: number
          pay_day: number | null
          paye_bands: Json
          paying_bank: string | null
          pension_employee_percent: number
          pension_employer_percent: number
          pension_label: string
          rent_relief_cap: number
          rent_relief_percent: number
          school_id: string
          tax_label: string
          tax_office: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payroll_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      payroll_submit: {
        Args: { target_run: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          id: string
          note: string | null
          paid_by: string | null
          paid_on: string | null
          period: string
          prepared_at: string
          prepared_by: string | null
          returned_at: string | null
          returned_note: string | null
          school_id: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payroll_runs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      payroll_withdraw_notice: {
        Args: { target_run: string }
        Returns: undefined
      }
      person_label: { Args: { target: string }; Returns: string }
      platform_add_admin: {
        Args: { target_email: string }
        Returns: {
          access_type: string
          created_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "platform_admins"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      platform_add_billing_record: {
        Args: {
          amount_in: number
          currency_in: string
          note_in?: string
          period_end_in: string
          period_start_in: string
          plan_in: string
          status_in?: string
          target_school: string
        }
        Returns: {
          amount: number
          created_at: string
          currency: string
          id: string
          note: string | null
          period_end: string
          period_start: string
          plan: string
          recorded_by: string | null
          school_id: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "billing_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      platform_archive_school: {
        Args: { archived: boolean; target_school: string }
        Returns: {
          address: string | null
          admission_letter_closing: string | null
          admission_letter_enrolled_intro: string | null
          admission_letter_offer_intro: string | null
          ai_token_limit: number
          allow_self_signup: boolean
          archived_at: string | null
          country: string | null
          created_at: string
          currency: string
          disabled_modules: string[]
          email: string | null
          id: string
          idle_lockout_enabled: boolean
          idle_lockout_minutes: number
          is_active: boolean
          logo_url: string | null
          name: string
          paid_until: string | null
          phone: string | null
          plan: string
          signatory_name: string | null
          signatory_title: string | null
          signature_url: string | null
          slug: string
          theme_color: string | null
          timezone: string
          trial_ends_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "schools"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      platform_audit_log: {
        Args: { limit_rows?: number; target_school?: string }
        Returns: {
          action: string
          actor_label: string
          changed_fields: string[]
          created_at: string
          id: string
          record_id: string
          school_id: string
          school_name: string
          table_name: string
        }[]
      }
      platform_billing_for_school: {
        Args: { target_school: string }
        Returns: {
          amount: number
          created_at: string
          currency: string
          id: string
          note: string | null
          period_end: string
          period_start: string
          plan: string
          recorded_by: string | null
          school_id: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "billing_records"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      platform_billing_records: {
        Args: { limit_rows?: number }
        Returns: {
          amount: number
          created_at: string
          currency: string
          id: string
          note: string
          period_end: string
          period_start: string
          plan: string
          school_id: string
          school_name: string
          status: string
        }[]
      }
      platform_export_school: { Args: { target_school: string }; Returns: Json }
      platform_extend_trial: {
        Args: { days: number; target_school: string }
        Returns: {
          address: string | null
          admission_letter_closing: string | null
          admission_letter_enrolled_intro: string | null
          admission_letter_offer_intro: string | null
          ai_token_limit: number
          allow_self_signup: boolean
          archived_at: string | null
          country: string | null
          created_at: string
          currency: string
          disabled_modules: string[]
          email: string | null
          id: string
          idle_lockout_enabled: boolean
          idle_lockout_minutes: number
          is_active: boolean
          logo_url: string | null
          name: string
          paid_until: string | null
          phone: string | null
          plan: string
          signatory_name: string | null
          signatory_title: string | null
          signature_url: string | null
          slug: string
          theme_color: string | null
          timezone: string
          trial_ends_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "schools"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      platform_gateways: {
        Args: never
        Returns: {
          confirmed_at: string
          is_active: boolean
          mode: string
          provider: string
          require_confirmation: boolean
          school_id: string
          school_name: string
        }[]
      }
      platform_get_secret: { Args: { which: string }; Returns: string }
      platform_grant_admin: {
        Args: {
          actor: string
          is_new: boolean
          target_user: string
          type_in?: string
        }
        Returns: undefined
      }
      platform_list_admins: {
        Args: never
        Returns: {
          access_type: string
          added_at: string
          email: string
          name: string
          user_id: string
        }[]
      }
      platform_mail_overview: { Args: never; Returns: Json }
      platform_mail_settings: { Args: never; Returns: Json }
      platform_mailbox_health: {
        Args: never
        Returns: {
          address: string
          is_active: boolean
          last_poll_at: string
          last_poll_error: string
          last_poll_status: string
          mailbox_id: string
          provider: string
          school_id: string
          school_name: string
        }[]
      }
      platform_microsoft: { Args: never; Returns: Json }
      platform_onboarding: {
        Args: { target_school: string }
        Returns: {
          has_application: boolean
          has_class: boolean
          has_gateway: boolean
          has_levels: boolean
          has_logo: boolean
          has_second_admin: boolean
          has_student: boolean
          has_theme: boolean
        }[]
      }
      platform_overview: {
        Args: never
        Returns: {
          active_schools: number
          applications: number
          courses: number
          people: number
          schools: number
          schools_added_30d: number
          staff: number
          students: number
        }[]
      }
      platform_remove_admin: {
        Args: { target_user: string }
        Returns: undefined
      }
      platform_remove_plan_price: {
        Args: { currency_in: string }
        Returns: undefined
      }
      platform_save_settings: {
        Args: { actor: string; settings: Json }
        Returns: undefined
      }
      platform_school_access: { Args: { target_slug: string }; Returns: Json }
      platform_schools: {
        Args: never
        Returns: {
          courses: number
          created_at: string
          id: string
          is_active: boolean
          members: number
          name: string
          plan: string
          slug: string
          students: number
          teachers: number
          trial_ends_at: string
        }[]
      }
      platform_search: {
        Args: { query: string }
        Returns: {
          matched_on: string
          school_id: string
          school_name: string
          school_slug: string
        }[]
      }
      platform_set_access_type: {
        Args: { target_user: string; type_in: string }
        Returns: undefined
      }
      platform_set_billing_status: {
        Args: { status_in: string; target_record: string }
        Returns: {
          amount: number
          created_at: string
          currency: string
          id: string
          note: string | null
          period_end: string
          period_start: string
          plan: string
          recorded_by: string | null
          school_id: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "billing_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      platform_set_microsoft_client: {
        Args: { client_in: string }
        Returns: undefined
      }
      platform_set_plan: {
        Args: { new_plan: string; target_school: string }
        Returns: {
          address: string | null
          admission_letter_closing: string | null
          admission_letter_enrolled_intro: string | null
          admission_letter_offer_intro: string | null
          ai_token_limit: number
          allow_self_signup: boolean
          archived_at: string | null
          country: string | null
          created_at: string
          currency: string
          disabled_modules: string[]
          email: string | null
          id: string
          idle_lockout_enabled: boolean
          idle_lockout_minutes: number
          is_active: boolean
          logo_url: string | null
          name: string
          paid_until: string | null
          phone: string | null
          plan: string
          signatory_name: string | null
          signatory_title: string | null
          signature_url: string | null
          slug: string
          theme_color: string | null
          timezone: string
          trial_ends_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "schools"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      platform_set_plan_price: {
        Args: { currency_in: string; growth_in: number; starter_in: number }
        Returns: undefined
      }
      platform_set_secret: {
        Args: { plaintext: string; which: string }
        Returns: undefined
      }
      platform_set_vercel_team: {
        Args: { team_in: string }
        Returns: undefined
      }
      platform_settings_view: { Args: never; Returns: Json }
      platform_tenant: {
        Args: { target_school: string }
        Returns: {
          applications: number
          archived_at: string
          courses: number
          created_at: string
          currency: string
          email: string
          id: string
          is_active: boolean
          last_activity: string
          logo_url: string
          members: number
          name: string
          parents: number
          phone: string
          plan: string
          result_sheets: number
          slug: string
          staff: number
          students: number
          timezone: string
          trial_ends_at: string
        }[]
      }
      platform_tenant_admins: {
        Args: { target_school: string }
        Returns: {
          email: string
          is_active: boolean
          name: string
          role: Database["classroom"]["Enums"]["member_role"]
          user_id: string
        }[]
      }
      platform_user_by_email: {
        Args: { target_email: string }
        Returns: string
      }
      platform_vercel_team: { Args: never; Returns: string }
      post_manual_journal: {
        Args: {
          entry_on: string
          lines: Json
          memo_in: string
          target_school: string
        }
        Returns: string
      }
      preview_discount: {
        Args: { target_invoice: string; target_rule: string }
        Returns: number
      }
      profile_label: { Args: { target_profile: string }; Returns: string }
      promote_applicant_to_student: {
        Args: {
          target_application: string
          target_class?: string
          target_school: string
          target_student: string
        }
        Returns: {
          application_id: string | null
          class_id: string | null
          created_at: string
          id: string
          notes: string | null
          registered_at: string
          registered_by: string | null
          registration_number: string
          school_id: string
          session_id: string | null
          status: string
          student_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "student_registrations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      public_admission_sessions: {
        Args: { target_school: string }
        Returns: {
          id: string
          name: string
        }[]
      }
      public_school: {
        Args: { target_slug: string }
        Returns: {
          id: string
          logo_url: string
          name: string
          slug: string
          theme_color: string
        }[]
      }
      public_school_levels: {
        Args: { target_slug: string }
        Returns: {
          label: string
          year: number
        }[]
      }
      publish_notice: {
        Args: { target_notice: string; target_school: string }
        Returns: {
          audience: Database["classroom"]["Enums"]["notice_audience"]
          author_id: string | null
          body: string
          created_at: string
          edited_at: string | null
          event_at: string | null
          event_place: string | null
          id: string
          is_event: boolean
          pinned: boolean
          published_at: string | null
          school_id: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "notices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      push_notify: { Args: { payload: Json }; Returns: undefined }
      raise_invoice: {
        Args: {
          discount?: number
          discount_reason?: string
          discount_rule?: string
          include_optional?: string[]
          target_structure: string
          target_student: string
        }
        Returns: {
          application_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          class_id: string | null
          created_at: string
          created_by: string | null
          discount: number
          discount_reason: string | null
          discount_rule_id: string | null
          due_on: string | null
          id: string
          issued_at: string | null
          issued_by: string | null
          notes: string | null
          purpose: string
          reference: string
          school_id: string
          seq: number
          session_id: string
          status: Database["classroom"]["Enums"]["invoice_status"]
          structure_id: string | null
          student_id: string | null
          term_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      raise_invoices_for_class: {
        Args: { target_structure: string }
        Returns: number
      }
      realtime_can_listen: { Args: { target_topic: string }; Returns: boolean }
      recalculate_attempt: {
        Args: { target_attempt: string }
        Returns: {
          auto_score: number | null
          auto_submitted: boolean
          disqualified: boolean
          disqualified_reason: string | null
          exam_id: string
          graded_at: string | null
          id: string
          max_score: number | null
          started_at: string
          submitted_at: string | null
          submitted_late: boolean
          total_score: number | null
          user_id: string
          violations: number
        }
        SetofOptions: {
          from: "*"
          to: "exam_attempts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      recompute_clearance_state: {
        Args: { target_application: string }
        Returns: undefined
      }
      record_admission_message: {
        Args: {
          error_in: string
          kind_in: string
          sent_by_in: string
          sent_to_in: string
          status_in: string
          subject_in: string
          target_application: string
          target_school: string
        }
        Returns: undefined
      }
      record_ai_usage: {
        Args: {
          error_in?: string
          input_tokens_in?: number
          model_in: string
          output_tokens_in?: number
          surface_in: string
          target_school: string
          user_in?: string
        }
        Returns: undefined
      }
      record_applicant_document_upload: {
        Args: {
          file_name_in: string
          file_path_in: string
          file_size_in: number
          kind_in?: string
          mime_type_in: string
          target_application: string
          target_requirement: string
          target_school: string
        }
        Returns: {
          application_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          document_id: string | null
          id: string
          requirement_id: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "applicant_documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_email_change: {
        Args: {
          actor: string
          new_email: string
          old_email: string
          target_school: string
          target_user: string
        }
        Returns: undefined
      }
      record_exam_violation: {
        Args: {
          target_attempt: string
          violation_detail?: string
          violation_kind: string
        }
        Returns: {
          auto_score: number | null
          auto_submitted: boolean
          disqualified: boolean
          disqualified_reason: string | null
          exam_id: string
          graded_at: string | null
          id: string
          max_score: number | null
          started_at: string
          submitted_at: string | null
          submitted_late: boolean
          total_score: number | null
          user_id: string
          violations: number
        }
        SetofOptions: {
          from: "*"
          to: "exam_attempts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_interview_outcome: {
        Args: {
          new_status: string
          notes_in?: string
          outcome_in?: string
          target_interview: string
          target_school: string
        }
        Returns: {
          application_id: string
          cancellation_reason: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          interviewer_id: string | null
          location: string | null
          meeting_link: string | null
          notes: string | null
          outcome: string | null
          scheduled_at: string
          scheduled_by: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "application_interviews"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_mailbox_poll_result: {
        Args: { error_in: string; status_in: string; target_mailbox: string }
        Returns: undefined
      }
      record_offer_response: {
        Args: {
          current_school: string
          note_in?: string
          response: string
          target_offer: string
        }
        Returns: {
          address: string | null
          applicant_id: string | null
          applying_for_level: number | null
          assigned_reviewer_id: string | null
          class_id: string | null
          clearance_state: string
          correction_reason: string | null
          correction_requested_at: string | null
          correction_requested_by: string | null
          correction_resubmitted_at: string | null
          correction_sections: string[] | null
          created_at: string
          date_of_birth: string | null
          decided_at: string | null
          decided_by: string | null
          decision_state: string
          declaration_accepted_at: string | null
          document_links: string | null
          documents_state: string
          education_history: Json | null
          exam_results: Json | null
          final_decided_at: string | null
          final_decided_by: string | null
          final_decision_note: string | null
          first_name: string
          form_state: string
          gender: string | null
          guardian_email: string
          guardian_name: string
          guardian_phone: string | null
          guardian_relation: string | null
          id: string
          interview_state: string
          it_ticket_id: string | null
          middle_name: string | null
          next_of_kin: Json | null
          notes: string | null
          offer_expires_at: string | null
          offer_state: string
          payment_state: string
          personal_info: Json | null
          previous_school: string | null
          programme_id: string | null
          referees: Json | null
          reference: string
          registration_state: string
          review_completed_at: string | null
          review_state: string
          school_id: string
          screening_completed_at: string | null
          screening_state: string
          seq: number
          session_id: string | null
          status: Database["classroom"]["Enums"]["application_status"]
          student_account_id: string | null
          student_id: string | null
          submitted_at: string | null
          submitted_snapshot: Json | null
          surname: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_original_verification: {
        Args: {
          document_kind_in: string
          remarks_in?: string
          target_application: string
          target_school: string
        }
        Returns: {
          application_id: string
          document_kind: string
          id: string
          remarks: string | null
          seen_at: string
          seen_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "original_verifications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_outbound_ticket_message: {
        Args: {
          actor: string
          bcc_addresses_in: string[]
          body_format_in?: string
          body_in: string
          cc_addresses_in: string[]
          email_message_id_in: string
          send_error_in: string
          send_status_in: string
          target_ticket: string
          to_addresses_in: string[]
        }
        Returns: {
          author_id: string | null
          bcc_addresses: string[] | null
          body: string
          body_format: string
          cc_addresses: string[] | null
          created_at: string
          direction: string
          email_message_id: string | null
          external_from: string | null
          id: string
          in_reply_to: string | null
          kind: string
          send_error: string | null
          send_status: string | null
          ticket_id: string
          to_addresses: string[] | null
        }
        SetofOptions: {
          from: "*"
          to: "ticket_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_password_reset: {
        Args: { actor: string; target_school: string; target_user: string }
        Returns: undefined
      }
      record_payee_payment: {
        Args: {
          description_in: string
          gross_in: number
          paid_from_in?: string
          paid_on_in: string
          reference_in?: string
          target_payee: string
          wht_rate_in?: number
        }
        Returns: {
          created_at: string
          description: string
          gross: number
          id: string
          net: number
          paid_from: string
          paid_on: string
          payee_id: string
          recorded_by: string | null
          reference: string | null
          school_id: string
          wht: number
          wht_rate: number
        }
        SetofOptions: {
          from: "*"
          to: "payroll_payee_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_review: {
        Args: {
          academic_score_in?: number
          interview_score_in?: number
          notes_in?: string
          recommendation_in: string
          target_application: string
        }
        Returns: {
          academic_score: number | null
          application_id: string
          assigned_at: string
          assigned_by: string | null
          completed_at: string | null
          created_at: string
          id: string
          interview_score: number | null
          notes: string | null
          recommendation: string | null
          reviewer_id: string
          total_score: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "application_reviews"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_school_attendance: {
        Args: {
          device_api_key: string
          event_source?: string
          event_time?: string
          person_identifier: string
        }
        Returns: {
          id: string
          person_name: string
          resumed_at: string
        }[]
      }
      record_store_sale: {
        Args: {
          buyer_name: string
          buyer_student: string
          lines: Json
          note?: string
          payment: string
          target_school: string
        }
        Returns: {
          buyer_name: string | null
          cost_total: number
          id: string
          invoice_id: string | null
          note: string | null
          payment: string
          reference: string
          school_id: string
          seq: number
          sold_at: string
          sold_by: string | null
          student_id: string | null
          total: number
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "store_sales"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_subscription_reminder: {
        Args: {
          days_in: number
          ends_on_in: string
          kind_in: string
          target_school: string
        }
        Returns: undefined
      }
      reference_year: { Args: { session_name: string }; Returns: string }
      refresh_documents_state: {
        Args: { target_application: string }
        Returns: undefined
      }
      reject_document: {
        Args: { reason_in: string; target_doc: string; target_school: string }
        Returns: {
          application_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          document_id: string | null
          id: string
          requirement_id: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "applicant_documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reject_payment: {
        Args: { decision: string; target_payment: string }
        Returns: {
          amount: number
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          gateway: string | null
          gateway_fee: number | null
          gateway_mode: string | null
          gateway_ref: string | null
          id: string
          invoice_id: string
          method: Database["classroom"]["Enums"]["payment_method"]
          note: string | null
          paid_on: string
          proof_path: string | null
          reference: string | null
          school_id: string
          status: Database["classroom"]["Enums"]["payment_status"]
          submitted_at: string
          submitted_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_brought_forward: {
        Args: { target_invoice: string }
        Returns: undefined
      }
      release_result_sheet: {
        Args: { note?: string; target_sheet: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          ca_max: number
          course_id: string
          created_at: string
          created_by: string | null
          exam_max: number
          id: string
          released_at: string | null
          released_by: string | null
          school_id: string
          status: Database["classroom"]["Enums"]["result_status"]
          submitted_at: string | null
          submitted_by: string | null
          term_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "result_sheets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remove_chat_member: {
        Args: { target_channel: string; target_user: string }
        Returns: undefined
      }
      report_overview: {
        Args: { target_school: string }
        Returns: {
          avatar_url: string
          class_name: string
          courses: Json
          email: string
          first_name: string
          is_my_child: boolean
          relationship: string
          student_id: string
          surname: string
        }[]
      }
      reportable_students: {
        Args: { target_school: string }
        Returns: {
          avatar_url: string
          email: string
          first_name: string
          student_id: string
          surname: string
        }[]
      }
      request_application_correction: {
        Args: {
          caller_school: string
          reason_in: string
          sections_in: string[]
          target_application: string
        }
        Returns: {
          address: string | null
          applicant_id: string | null
          applying_for_level: number | null
          assigned_reviewer_id: string | null
          class_id: string | null
          clearance_state: string
          correction_reason: string | null
          correction_requested_at: string | null
          correction_requested_by: string | null
          correction_resubmitted_at: string | null
          correction_sections: string[] | null
          created_at: string
          date_of_birth: string | null
          decided_at: string | null
          decided_by: string | null
          decision_state: string
          declaration_accepted_at: string | null
          document_links: string | null
          documents_state: string
          education_history: Json | null
          exam_results: Json | null
          final_decided_at: string | null
          final_decided_by: string | null
          final_decision_note: string | null
          first_name: string
          form_state: string
          gender: string | null
          guardian_email: string
          guardian_name: string
          guardian_phone: string | null
          guardian_relation: string | null
          id: string
          interview_state: string
          it_ticket_id: string | null
          middle_name: string | null
          next_of_kin: Json | null
          notes: string | null
          offer_expires_at: string | null
          offer_state: string
          payment_state: string
          personal_info: Json | null
          previous_school: string | null
          programme_id: string | null
          referees: Json | null
          reference: string
          registration_state: string
          review_completed_at: string | null
          review_state: string
          school_id: string
          screening_completed_at: string | null
          screening_state: string
          seq: number
          session_id: string | null
          status: Database["classroom"]["Enums"]["application_status"]
          student_account_id: string | null
          student_id: string | null
          submitted_at: string | null
          submitted_snapshot: Json | null
          surname: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_enrollment: {
        Args: { note?: string; target_course: string }
        Returns: {
          course_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          message: string | null
          requested_at: string
          status: Database["classroom"]["Enums"]["enrollment_status"]
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "enrollments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_school_access: {
        Args: { reason: string; target_slug: string }
        Returns: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decline_note: string | null
          expires_at: string | null
          hours: number | null
          id: string
          reason: string
          school_id: string
          status: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "platform_access_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_student_account: {
        Args: { note_in?: string; target_application: string }
        Returns: Json
      }
      require_password_change: {
        Args: { target_user: string }
        Returns: undefined
      }
      restock_store_product: {
        Args: {
          note?: string
          qty: number
          target_product: string
          unit_cost?: number
          unit_discount?: number
        }
        Returns: {
          category: string
          cost_price: number
          created_at: string
          id: string
          is_active: boolean
          name: string
          net_cost: number | null
          reorder_level: number
          school_id: string
          sell_price: number
          size: string | null
          stock_qty: number
          supplier: string | null
          trade_discount: number
          unit_profit: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "store_products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resubmit_application_correction: {
        Args: { target_application: string }
        Returns: {
          address: string | null
          applicant_id: string | null
          applying_for_level: number | null
          assigned_reviewer_id: string | null
          class_id: string | null
          clearance_state: string
          correction_reason: string | null
          correction_requested_at: string | null
          correction_requested_by: string | null
          correction_resubmitted_at: string | null
          correction_sections: string[] | null
          created_at: string
          date_of_birth: string | null
          decided_at: string | null
          decided_by: string | null
          decision_state: string
          declaration_accepted_at: string | null
          document_links: string | null
          documents_state: string
          education_history: Json | null
          exam_results: Json | null
          final_decided_at: string | null
          final_decided_by: string | null
          final_decision_note: string | null
          first_name: string
          form_state: string
          gender: string | null
          guardian_email: string
          guardian_name: string
          guardian_phone: string | null
          guardian_relation: string | null
          id: string
          interview_state: string
          it_ticket_id: string | null
          middle_name: string | null
          next_of_kin: Json | null
          notes: string | null
          offer_expires_at: string | null
          offer_state: string
          payment_state: string
          personal_info: Json | null
          previous_school: string | null
          programme_id: string | null
          referees: Json | null
          reference: string
          registration_state: string
          review_completed_at: string | null
          review_state: string
          school_id: string
          screening_completed_at: string | null
          screening_state: string
          seq: number
          session_id: string | null
          status: Database["classroom"]["Enums"]["application_status"]
          student_account_id: string | null
          student_id: string | null
          submitted_at: string | null
          submitted_snapshot: Json | null
          surname: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      return_result_sheet: {
        Args: { note: string; target_sheet: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          ca_max: number
          course_id: string
          created_at: string
          created_by: string | null
          exam_max: number
          id: string
          released_at: string | null
          released_by: string | null
          school_id: string
          status: Database["classroom"]["Enums"]["result_status"]
          submitted_at: string | null
          submitted_by: string | null
          term_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "result_sheets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reverse_journal: {
        Args: { entry_on?: string; reason: string; target_entry: string }
        Returns: string
      }
      rt_body: {
        Args: { new_row: Json; old_row: Json; op: string; tbl: string }
        Returns: Json
      }
      rt_send: {
        Args: { body: Json; event_name: string; target_topic: string }
        Returns: undefined
      }
      save_account: {
        Args: {
          active_in?: boolean
          code_in: string
          description_in?: string
          name_in: string
          target_account: string
          target_school: string
          type_in: string
        }
        Returns: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          position: number
          school_id: string
          system_key: string | null
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "chart_of_accounts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_application_section: {
        Args: {
          payload: Json
          section_name: string
          target_application: string
        }
        Returns: {
          address: string | null
          applicant_id: string | null
          applying_for_level: number | null
          assigned_reviewer_id: string | null
          class_id: string | null
          clearance_state: string
          correction_reason: string | null
          correction_requested_at: string | null
          correction_requested_by: string | null
          correction_resubmitted_at: string | null
          correction_sections: string[] | null
          created_at: string
          date_of_birth: string | null
          decided_at: string | null
          decided_by: string | null
          decision_state: string
          declaration_accepted_at: string | null
          document_links: string | null
          documents_state: string
          education_history: Json | null
          exam_results: Json | null
          final_decided_at: string | null
          final_decided_by: string | null
          final_decision_note: string | null
          first_name: string
          form_state: string
          gender: string | null
          guardian_email: string
          guardian_name: string
          guardian_phone: string | null
          guardian_relation: string | null
          id: string
          interview_state: string
          it_ticket_id: string | null
          middle_name: string | null
          next_of_kin: Json | null
          notes: string | null
          offer_expires_at: string | null
          offer_state: string
          payment_state: string
          personal_info: Json | null
          previous_school: string | null
          programme_id: string | null
          referees: Json | null
          reference: string
          registration_state: string
          review_completed_at: string | null
          review_state: string
          school_id: string
          screening_completed_at: string | null
          screening_state: string
          seq: number
          session_id: string | null
          status: Database["classroom"]["Enums"]["application_status"]
          student_account_id: string | null
          student_id: string | null
          submitted_at: string | null
          submitted_snapshot: Json | null
          surname: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_notification_prefs: {
        Args: { chat_email_in: boolean }
        Returns: undefined
      }
      save_opening_balances: {
        Args: { lines: Json; target_school: string }
        Returns: string
      }
      save_push_subscription: {
        Args: {
          agent_in?: string
          auth_in: string
          endpoint_in: string
          p256dh_in: string
          school_in?: string
        }
        Returns: undefined
      }
      schedule_interview: {
        Args: {
          interviewer_in?: string
          location_in?: string
          meeting_link_in?: string
          target_application: string
          target_school: string
          when_at: string
        }
        Returns: {
          application_id: string
          cancellation_reason: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          interviewer_id: string | null
          location: string | null
          meeting_link: string | null
          notes: string | null
          outcome: string | null
          scheduled_at: string
          scheduled_by: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "application_interviews"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      school_access_requests: {
        Args: { target_school: string }
        Returns: {
          created_at: string
          decided_at: string
          decided_by_name: string
          decline_note: string
          expires_at: string
          hours: number
          id: string
          reason: string
          requester_email: string
          requester_name: string
          status: string
          user_id: string
        }[]
      }
      school_approvers: { Args: { target_school: string }; Returns: string[] }
      school_plan_quote: { Args: { target_school: string }; Returns: Json }
      school_presence: {
        Args: { target_school: string }
        Returns: {
          last_seen_at: string
          last_sign_in_at: string
          user_id: string
        }[]
      }
      set_chat_member_role: {
        Args: { new_role: string; target_channel: string; target_user: string }
        Returns: undefined
      }
      set_clearance_status: {
        Args: {
          expected_school: string
          new_status: string
          note_in?: string
          target_checklist: string
        }
        Returns: {
          application_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          department_id: string
          id: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "clearance_checklists"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_current_term: {
        Args: { target_school: string; target_term: string }
        Returns: {
          created_at: string
          ends_on: string | null
          id: string
          is_current: boolean
          name: string
          position: number
          school_id: string
          session_id: string
          starts_on: string | null
        }
        SetofOptions: {
          from: "*"
          to: "terms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_document_status: {
        Args: {
          new_status: string
          note_in?: string
          target_doc: string
          target_school: string
        }
        Returns: {
          application_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          document_id: string | null
          id: string
          requirement_id: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "applicant_documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_gateway_secret: {
        Args: { secrets: Json; target_gateway: string }
        Returns: undefined
      }
      set_mailbox_secret: {
        Args: { plaintext: string; target_mailbox: string; which: string }
        Returns: undefined
      }
      set_screening_item_status: {
        Args: {
          new_status: string
          note_in?: string
          target_item: string
          target_school: string
        }
        Returns: {
          application_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          is_required: boolean
          kind: string
          label: string
          position: number
          requirement_id: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "application_screening_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_timetable_slot: {
        Args: {
          label_in: string
          room_in: string
          subject_in: string
          target_class: string
          target_day: number
          target_period: string
          target_term: string
        }
        Returns: {
          class_id: string
          class_subject_id: string | null
          created_by: string | null
          day: number
          id: string
          label: string | null
          period_id: string
          room: string | null
          school_id: string
          teacher_id: string | null
          term_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "timetable_slots"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      settle_online_payment: {
        Args: {
          gateway_fee?: number
          gateway_mode?: string
          gateway_name: string
          gateway_reference: string
          paid_amount: number
          payer?: string
          target_invoice: string
          verified_school_id?: string
        }
        Returns: {
          amount: number
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          gateway: string | null
          gateway_fee: number | null
          gateway_mode: string | null
          gateway_ref: string | null
          id: string
          invoice_id: string
          method: Database["classroom"]["Enums"]["payment_method"]
          note: string | null
          paid_on: string
          proof_path: string | null
          reference: string | null
          school_id: string
          status: Database["classroom"]["Enums"]["payment_status"]
          submitted_at: string
          submitted_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sign_in_email: {
        Args: { school_slug: string; username_in: string }
        Returns: string
      }
      slug_available: { Args: { candidate: string }; Returns: boolean }
      start_application: {
        Args: { target_programme?: string; target_session: string }
        Returns: {
          address: string | null
          applicant_id: string | null
          applying_for_level: number | null
          assigned_reviewer_id: string | null
          class_id: string | null
          clearance_state: string
          correction_reason: string | null
          correction_requested_at: string | null
          correction_requested_by: string | null
          correction_resubmitted_at: string | null
          correction_sections: string[] | null
          created_at: string
          date_of_birth: string | null
          decided_at: string | null
          decided_by: string | null
          decision_state: string
          declaration_accepted_at: string | null
          document_links: string | null
          documents_state: string
          education_history: Json | null
          exam_results: Json | null
          final_decided_at: string | null
          final_decided_by: string | null
          final_decision_note: string | null
          first_name: string
          form_state: string
          gender: string | null
          guardian_email: string
          guardian_name: string
          guardian_phone: string | null
          guardian_relation: string | null
          id: string
          interview_state: string
          it_ticket_id: string | null
          middle_name: string | null
          next_of_kin: Json | null
          notes: string | null
          offer_expires_at: string | null
          offer_state: string
          payment_state: string
          personal_info: Json | null
          previous_school: string | null
          programme_id: string | null
          referees: Json | null
          reference: string
          registration_state: string
          review_completed_at: string | null
          review_state: string
          school_id: string
          screening_completed_at: string | null
          screening_state: string
          seq: number
          session_id: string | null
          status: Database["classroom"]["Enums"]["application_status"]
          student_account_id: string | null
          student_id: string | null
          submitted_at: string | null
          submitted_snapshot: Json | null
          surname: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_exam_attempt: {
        Args: { target_exam: string }
        Returns: {
          auto_score: number | null
          auto_submitted: boolean
          disqualified: boolean
          disqualified_reason: string | null
          exam_id: string
          graded_at: string | null
          id: string
          max_score: number | null
          started_at: string
          submitted_at: string | null
          submitted_late: boolean
          total_score: number | null
          user_id: string
          violations: number
        }
        SetofOptions: {
          from: "*"
          to: "exam_attempts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_subscription_payment: {
        Args: { actor: string; ref: string; target_school: string }
        Returns: Json
      }
      start_trial_school: {
        Args: {
          country_in?: string
          currency_in?: string
          school_name: string
          school_slug: string
          timezone_in?: string
        }
        Returns: {
          address: string | null
          admission_letter_closing: string | null
          admission_letter_enrolled_intro: string | null
          admission_letter_offer_intro: string | null
          ai_token_limit: number
          allow_self_signup: boolean
          archived_at: string | null
          country: string | null
          created_at: string
          currency: string
          disabled_modules: string[]
          email: string | null
          id: string
          idle_lockout_enabled: boolean
          idle_lockout_minutes: number
          is_active: boolean
          logo_url: string | null
          name: string
          paid_until: string | null
          phone: string | null
          plan: string
          signatory_name: string | null
          signatory_title: string | null
          signature_url: string | null
          slug: string
          theme_color: string | null
          timezone: string
          trial_ends_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "schools"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      storage_path_unclaimed: {
        Args: { target_path: string }
        Returns: boolean
      }
      store_profit: {
        Args: { from_date?: string; target_school: string; to_date?: string }
        Returns: {
          category: string
          cost: number
          name: string
          product_id: string
          profit: number
          qty_sold: number
          revenue: number
          size: string
        }[]
      }
      student_marks: {
        Args: { target_school: string; target_student: string }
        Returns: {
          course_code: string
          happened_at: string
          kind: string
          late: boolean
          out_of: number
          scored: number
          title: string
        }[]
      }
      student_report: {
        Args: { target_school: string; target_student: string }
        Returns: {
          assignments_done: number
          assignments_graded: number
          assignments_ontime: number
          assignments_set: number
          course_code: string
          course_id: string
          course_title: string
          exam_max: number
          exam_score: number
          exams_sat: number
          last_activity: string
          level_year: number
          messages_sent: number
          points_earned: number
          points_possible: number
          reactions_given: number
        }[]
      }
      submit_application: {
        Args: {
          address?: string
          applying_for_level?: number
          date_of_birth?: string
          document_links?: string
          document_uploads?: Json
          first_name: string
          gender?: string
          guardian_email: string
          guardian_name: string
          guardian_phone?: string
          guardian_relation?: string
          middle_name?: string
          notes?: string
          previous_school?: string
          surname: string
          target_slug: string
        }
        Returns: {
          reference: string
          school_name: string
        }[]
      }
      submit_exam_attempt: {
        Args: { target_attempt: string }
        Returns: {
          auto_score: number | null
          auto_submitted: boolean
          disqualified: boolean
          disqualified_reason: string | null
          exam_id: string
          graded_at: string | null
          id: string
          max_score: number | null
          started_at: string
          submitted_at: string | null
          submitted_late: boolean
          total_score: number | null
          user_id: string
          violations: number
        }
        SetofOptions: {
          from: "*"
          to: "exam_attempts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_my_application: {
        Args: { declaration_accepted: boolean; target_application: string }
        Returns: {
          address: string | null
          applicant_id: string | null
          applying_for_level: number | null
          assigned_reviewer_id: string | null
          class_id: string | null
          clearance_state: string
          correction_reason: string | null
          correction_requested_at: string | null
          correction_requested_by: string | null
          correction_resubmitted_at: string | null
          correction_sections: string[] | null
          created_at: string
          date_of_birth: string | null
          decided_at: string | null
          decided_by: string | null
          decision_state: string
          declaration_accepted_at: string | null
          document_links: string | null
          documents_state: string
          education_history: Json | null
          exam_results: Json | null
          final_decided_at: string | null
          final_decided_by: string | null
          final_decision_note: string | null
          first_name: string
          form_state: string
          gender: string | null
          guardian_email: string
          guardian_name: string
          guardian_phone: string | null
          guardian_relation: string | null
          id: string
          interview_state: string
          it_ticket_id: string | null
          middle_name: string | null
          next_of_kin: Json | null
          notes: string | null
          offer_expires_at: string | null
          offer_state: string
          payment_state: string
          personal_info: Json | null
          previous_school: string | null
          programme_id: string | null
          referees: Json | null
          reference: string
          registration_state: string
          review_completed_at: string | null
          review_state: string
          school_id: string
          screening_completed_at: string | null
          screening_state: string
          seq: number
          session_id: string | null
          status: Database["classroom"]["Enums"]["application_status"]
          student_account_id: string | null
          student_id: string | null
          submitted_at: string | null
          submitted_snapshot: Json | null
          surname: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_result_sheet: {
        Args: { note?: string; target_sheet: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          ca_max: number
          course_id: string
          created_at: string
          created_by: string | null
          exam_max: number
          id: string
          released_at: string | null
          released_by: string | null
          school_id: string
          status: Database["classroom"]["Enums"]["result_status"]
          submitted_at: string | null
          submitted_by: string | null
          term_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "result_sheets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      take_payment: {
        Args: {
          amount: number
          method?: Database["classroom"]["Enums"]["payment_method"]
          note?: string
          paid_on?: string
          reference?: string
          target_invoice: string
        }
        Returns: {
          amount: number
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          gateway: string | null
          gateway_fee: number | null
          gateway_mode: string | null
          gateway_ref: string | null
          id: string
          invoice_id: string
          method: Database["classroom"]["Enums"]["payment_method"]
          note: string | null
          paid_on: string
          proof_path: string | null
          reference: string | null
          school_id: string
          status: Database["classroom"]["Enums"]["payment_status"]
          submitted_at: string
          submitted_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ticket_group_history: {
        Args: { target_school: string; target_ticket: string }
        Returns: {
          actor_label: string
          changed_at: string
          from_group_name: string
          to_group_name: string
        }[]
      }
      tidy_spaces: { Args: { value: string }; Returns: string }
      touch_presence: { Args: never; Returns: undefined }
      track_application: {
        Args: { target_email: string; target_reference: string }
        Returns: {
          applicant: string
          correction_reason: string
          correction_sections: string[]
          decided_at: string
          first_name: string
          form_state: string
          offer_expires_at: string
          reference: string
          school_name: string
          session_name: string
          status: Database["classroom"]["Enums"]["application_status"]
          submitted_at: string
          surname: string
        }[]
      }
      try_uuid: { Args: { value: string }; Returns: string }
      undo_carry_forward: {
        Args: { target_invoice: string }
        Returns: undefined
      }
      unrelease_result_sheet: {
        Args: { note: string; target_sheet: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          ca_max: number
          course_id: string
          created_at: string
          created_by: string | null
          exam_max: number
          id: string
          released_at: string | null
          released_by: string | null
          school_id: string
          status: Database["classroom"]["Enums"]["result_status"]
          submitted_at: string | null
          submitted_by: string | null
          term_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "result_sheets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_fee_structure: {
        Args: { due_on_in: string; name_in: string; target_structure: string }
        Returns: {
          class_id: string | null
          created_at: string
          created_by: string | null
          due_on: string | null
          id: string
          is_active: boolean
          level_year: number | null
          name: string
          notes: string | null
          purpose: string
          school_id: string
          session_id: string
          term_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "fee_structures"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_ticket: {
        Args: {
          assigned_to_in?: string
          clear_assignee?: boolean
          clear_group?: boolean
          group_id_in?: string
          priority_in?: string
          status_in?: string
          tags_in?: string[]
          target_school: string
          target_ticket: string
        }
        Returns: {
          assigned_to: string | null
          channel: string
          closed_at: string | null
          created_at: string
          description: string
          description_format: string
          first_response_at: string | null
          group_id: string | null
          id: string
          mailbox_id: string | null
          number: number
          origin_message_id: string | null
          priority: string
          requester_email: string | null
          requester_id: string | null
          requester_name: string | null
          resolved_at: string | null
          school_id: string
          status: string
          subject: string
          tags: string[]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_payment_gateway: {
        Args: {
          confirmed_by_in?: string
          mode_in: string
          provider_in: string
          public_config_in?: Json
          require_confirmation_in: boolean
          secrets_in?: Json
          target_school: string
        }
        Returns: {
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          id: string
          is_active: boolean
          mode: string | null
          provider: string | null
          public_config: Json
          require_confirmation: boolean
          school_id: string
          secret_vault_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payment_gateways"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      verify_application_payment_gateway: {
        Args: {
          amount_paid: number
          gateway_ref_in: string
          paid_at_in?: string
          target_payment: string
        }
        Returns: {
          address: string | null
          applicant_id: string | null
          applying_for_level: number | null
          assigned_reviewer_id: string | null
          class_id: string | null
          clearance_state: string
          correction_reason: string | null
          correction_requested_at: string | null
          correction_requested_by: string | null
          correction_resubmitted_at: string | null
          correction_sections: string[] | null
          created_at: string
          date_of_birth: string | null
          decided_at: string | null
          decided_by: string | null
          decision_state: string
          declaration_accepted_at: string | null
          document_links: string | null
          documents_state: string
          education_history: Json | null
          exam_results: Json | null
          final_decided_at: string | null
          final_decided_by: string | null
          final_decision_note: string | null
          first_name: string
          form_state: string
          gender: string | null
          guardian_email: string
          guardian_name: string
          guardian_phone: string | null
          guardian_relation: string | null
          id: string
          interview_state: string
          it_ticket_id: string | null
          middle_name: string | null
          next_of_kin: Json | null
          notes: string | null
          offer_expires_at: string | null
          offer_state: string
          payment_state: string
          personal_info: Json | null
          previous_school: string | null
          programme_id: string | null
          referees: Json | null
          reference: string
          registration_state: string
          review_completed_at: string | null
          review_state: string
          school_id: string
          screening_completed_at: string | null
          screening_state: string
          seq: number
          session_id: string | null
          status: Database["classroom"]["Enums"]["application_status"]
          student_account_id: string | null
          student_id: string | null
          submitted_at: string | null
          submitted_snapshot: Json | null
          surname: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "applications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      verify_document: {
        Args: { note_in?: string; target_doc: string; target_school: string }
        Returns: {
          application_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          document_id: string | null
          id: string
          requirement_id: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "applicant_documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      void_store_sale: {
        Args: { reason: string; target_sale: string }
        Returns: {
          buyer_name: string | null
          cost_total: number
          id: string
          invoice_id: string | null
          note: string | null
          payment: string
          reference: string
          school_id: string
          seq: number
          sold_at: string
          sold_by: string | null
          student_id: string | null
          total: number
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "store_sales"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      waive_document: {
        Args: { reason_in: string; target_doc: string; target_school: string }
        Returns: {
          application_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          document_id: string | null
          id: string
          requirement_id: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "applicant_documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      application_status:
        | "submitted"
        | "screening"
        | "offered"
        | "accepted"
        | "enrolled"
        | "declined"
        | "rejected"
        | "withdrawn"
        | "draft"
        | "in_progress"
        | "under_review"
        | "document_review"
        | "interview_required"
        | "interview_completed"
        | "waitlisted"
        | "deferred"
      enrollment_status: "pending" | "approved" | "declined"
      invoice_status: "draft" | "issued" | "cancelled"
      join_policy: "open" | "approval"
      member_role:
        | "owner"
        | "admin"
        | "bursar"
        | "admissions"
        | "teacher"
        | "student"
        | "parent"
        | "principal"
      notice_audience: "everyone" | "parents" | "students" | "staff"
      payment_method:
        | "cash"
        | "transfer"
        | "pos"
        | "cheque"
        | "online"
        | "waiver"
        | "carried_forward"
      payment_status: "submitted" | "approved" | "rejected"
      question_kind: "multiple_choice" | "true_false" | "short_answer"
      result_status:
        | "draft"
        | "submitted"
        | "approved"
        | "released"
        | "returned"
      user_role: "student" | "tutor" | "admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  classroom: {
    Enums: {
      application_status: [
        "submitted",
        "screening",
        "offered",
        "accepted",
        "enrolled",
        "declined",
        "rejected",
        "withdrawn",
        "draft",
        "in_progress",
        "under_review",
        "document_review",
        "interview_required",
        "interview_completed",
        "waitlisted",
        "deferred",
      ],
      enrollment_status: ["pending", "approved", "declined"],
      invoice_status: ["draft", "issued", "cancelled"],
      join_policy: ["open", "approval"],
      member_role: [
        "owner",
        "admin",
        "bursar",
        "admissions",
        "teacher",
        "student",
        "parent",
        "principal",
      ],
      notice_audience: ["everyone", "parents", "students", "staff"],
      payment_method: [
        "cash",
        "transfer",
        "pos",
        "cheque",
        "online",
        "waiver",
        "carried_forward",
      ],
      payment_status: ["submitted", "approved", "rejected"],
      question_kind: ["multiple_choice", "true_false", "short_answer"],
      result_status: ["draft", "submitted", "approved", "released", "returned"],
      user_role: ["student", "tutor", "admin"],
    },
  },
} as const
