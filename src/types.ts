export interface CommandEntry {
  name: string
  message: string
}

export interface NetworkError {
  method: string
  url: string
  status: number
}
