import {
  DaprServer,
  DaprWorkflowClient,
  TWorkflow,
  WorkflowActivityContext,
  WorkflowContext,
  WorkflowRuntime,
} from '@dapr/dapr';
import express, { Request, Response } from 'express';

export const main = async () => {
  const app = express();

  const daprHost = 'localhost';
  const daprPort = '50001';
  const workflowClient = new DaprWorkflowClient({
    daprHost,
    daprPort,
  });
  const workflowRuntime = new WorkflowRuntime({
    daprHost,
    daprPort,
  });

  const server = new DaprServer({
    serverHost: daprHost,
    serverPort: '3000',
    serverHttp: app,
  });

  interface SeatReservation {
    locationPreference: SeatTypeEnum; // 'aisle' | 'window' | 'middle';
    name: string;
    id: string;
  }

  enum SeatTypeEnum {
    aisle = 'aisle',
    window = 'window',
    middle = 'middle',
  }

  interface Seat {
    seat: string;
    available: boolean;
  }

  const seatsA: Seat[] = [
    { seat: 'A1', available: false },
    { seat: 'A2', available: false },
    { seat: 'A3', available: false },
    { seat: 'A4', available: false },
    { seat: 'A5', available: false },
    { seat: 'A6', available: false },
  ];
  const seatsB: Seat[] = [
    { seat: 'B1', available: true },
    { seat: 'B2', available: true },
    { seat: 'B3', available: true },
    { seat: 'B4', available: true },
    { seat: 'B5', available: true },
    { seat: 'B6', available: true },
  ];
  const seatsC: Seat[] = [
    { seat: 'C1', available: true },
    { seat: 'C2', available: true },
    { seat: 'C3', available: true },
    { seat: 'C4', available: true },
    { seat: 'C5', available: true },
    { seat: 'C6', available: true },
  ];

  const validateAvailableSeat = (
    _: WorkflowActivityContext,
    locationPreference: SeatTypeEnum
  ): boolean => {
    let available: boolean = false;
    switch (locationPreference) {
      case SeatTypeEnum.aisle:
        available = seatsA.some((seat) => seat.available);
        break;
      case SeatTypeEnum.middle:
        available = seatsB.some((seat) => seat.available);
        break;
      case SeatTypeEnum.window:
        available = seatsC.some((seat) => seat.available);
        break;
    }

    return available;
  };

  function getRandomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  const getAvailableSeats = (
    _: WorkflowActivityContext,
    locationPreferences: SeatTypeEnum[]
  ): Seat[] => {
    return locationPreferences
      .reduce<Seat[][]>((acc, curr) => {
        switch (curr) {
          case SeatTypeEnum.aisle:
            acc.push(seatsA.filter((seat) => seat.available));
            break;
          case SeatTypeEnum.middle:
            acc.push(seatsB.filter((seat) => seat.available));
            break;
          case SeatTypeEnum.window:
          default:
            acc.push(seatsC.filter((seat) => seat.available));
            break;
        }

        return acc;
      }, [])
      .flat();
  };

  const getRandomSeat = async (_: WorkflowActivityContext, seats: Seat[]) => {
    return seats.at(getRandomInt(0, seats.length - 1));
  };

  const sequence: TWorkflow = async function* (
    ctx: WorkflowContext,
    reservation: SeatReservation
  ): any {
    const areAvailableSeats = yield ctx.callActivity(
      validateAvailableSeat,
      reservation.locationPreference
    );
    if (areAvailableSeats) {
      const availableSeatsByPreference = yield ctx.callActivity(
        getAvailableSeats,
        [reservation.locationPreference]
      );

      const { seat }: Seat = yield ctx.callActivity(
        getRandomSeat,
        availableSeatsByPreference
      );

      return `The Selected seat for this flight is: ${seat}`;
    }

    const availableSeats = yield ctx.callActivity(
      getAvailableSeats,
      Object.keys(SeatTypeEnum).filter(
        (locationPreference) =>
          locationPreference !== reservation.locationPreference
      )
    );

    const { seat }: Seat = yield ctx.callActivity(
      getRandomSeat,
      availableSeats
    );

    return `The Random Selected seat for this flight is: ${seat}, because there are not any seat available in your location preference.`;
  };

  workflowRuntime
    .registerWorkflow(sequence)
    .registerActivity(getAvailableSeats)
    .registerActivity(validateAvailableSeat)
    .registerActivity(getRandomSeat);

  await workflowRuntime.start();
  await server.start(); // Start the server

  app.post('/auto-seat-reservation', async (req: Request, res: Response) => {
    const seatReservation = req.body as SeatReservation;

    try {
      const id = await workflowClient.scheduleNewWorkflow(
        sequence,
        seatReservation
      );
      console.log(`Orchestration scheduled with ID: ${id}`);

      // Wait for orchestration completion
      const state = await workflowClient.waitForWorkflowCompletion(
        id,
        undefined,
        30
      );

      console.log(
        `Orchestration completed! Result: ${state?.serializedOutput}`
      );

      res.send({ msg: 'Workflow received' });
    } catch (error) {
      console.error('Error scheduling or waiting for orchestration:', error);
    }
  });
};

main().catch(console.log);
